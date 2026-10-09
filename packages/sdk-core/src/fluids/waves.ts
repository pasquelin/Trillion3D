import { length2, normalizeVector2, normalizeVector3 } from '../../../math/src/vector/vector.ts'
import { HALF_PI, TAU } from '../../../math/src/constants.ts'
import { wrap } from '../../../math/src/scalar/reals.ts'
import { ceilDiv } from '../../../math/src/scalar/integers.ts'

/**
 * The one wave model of the engine: a sum of trochoidal waves. Buoyancy reads it on the CPU (the
 * physics worker); the water surface's shader code takes the same numbers,
 * so nothing about a wave is written twice. A trochoidal wave moves a
 * point of the rest plane both up and sideways, towards the crest, so the height above a world
 * position is found by iterating on the rest position (`surface.ts`). The previous
 * frame's surface is the same formula at `t - dt`: nothing is stored.
 */

/** One wave as a scene declares it. */
export interface WaveSpec {
  /** Horizontal direction of travel `[x, z]`; normalised here. */
  direction: readonly [number, number]
  /** Metres from crest to crest. */
  wavelength: number
  /** Metres from rest to crest. */
  amplitude: number
  /** 0 (a sine wave) to 1 (the sharpest crest that does not loop); normalised over the sum. */
  steepness: number
  /** Phase at `t = 0`, radians. */
  phase?: number
}

/** Deep-water gravity, m/s²: a wave's angular speed is `sqrt(GRAVITY × k)`. */
const WAVE_GRAVITY = 9.81

/**
 * The least and greatest of the cosine, then of the sine, over the angles `[a, b]`, into `out`:
 * their ends', or −1 and 1 where the span holds a trough or a crest — the quarter turns `jπ/2` it
 * holds, the cosine's crest at `j ≡ 0 (mod 4)` and trough at 2, the sine's at 1 and 3.
 */
function trigSpan(a: number, b: number, out: Float64Array) {
  const ca = Math.cos(a),
    cb = Math.cos(b),
    sa = Math.sin(a),
    sb = Math.sin(b)
  out[0] = Math.min(ca, cb)
  out[1] = Math.max(ca, cb)
  out[2] = Math.min(sa, sb)
  out[3] = Math.max(sa, sb)
  const first = ceilDiv(a, HALF_PI),
    last = Math.min(Math.floor(b / HALF_PI), first + 3)
  for (let j = first; j <= last; j++) {
    const turn = wrap(j, 4)
    if (turn === 0) out[1] = 1
    else if (turn === 1) out[3] = 1
    else if (turn === 2) out[0] = -1
    else out[2] = -1
  }
}
/** A cosine's least and greatest then a sine's, rewritten by each wave of `displacementBox`. */
const spans = new Float64Array(4)

/** The arrays of one wave, in the order the module's planes read its doubles (`jolt_wave_buffer`,
 *  `waterPlanes.cpp`): direction x, z, wave number, amplitude, lateral amplitude, phase at the
 *  step's time. */
export const WAVE_FIELDS = ['dirX', 'dirZ', 'k', 'amplitude', 'lateral', 'phase'] as const
/** Doubles of one wave the module's planes read. */
export const WAVE_DOUBLES = WAVE_FIELDS.length

/** The slots of a wave's terms (`waveTerms`): the displacement it adds, then what it takes from the
 *  surface's unnormalised normal; the rest point's (`waveRest.ts`) exported. */
export const OFFSET_X = 0,
  OFFSET_Z = 2,
  NORMAL_Y = 4
const OFFSET_Y = 1,
  NORMAL_X = 3,
  NORMAL_Z = 5
/** Slots of a wave's terms. */
export const TERM_COUNT = NORMAL_Z + 1
/** The slots of a wave's terms by what they sum into: the displacement, then the normal. */
export const TERM_SLOTS = {
  offset: [OFFSET_X, OFFSET_Y, OFFSET_Z],
  normal: [NORMAL_X, NORMAL_Y, NORMAL_Z],
} as const

/**
 * The terms of wave `i` of `waves` at the rest point `(x, z)`, into `out` at their slots: the
 * displacement it adds (`OFFSET_X` to `OFFSET_Z`), then what it takes from the surface's
 * unnormalised normal (`NORMAL_X` to `NORMAL_Z`). The one formula of a wave: `Waves.offset` and
 * `Waves.normal` sum it, and the GPU deformation its WGSL print (`scripts/generate-shared-rules.ts`).
 */
export function waveTerms(waves: Waves, i: number, x: number, z: number, out: Float64Array) {
  const dx = waves.dirX[i],
    dz = waves.dirZ[i],
    k = waves.k[i],
    amplitude = waves.amplitude[i],
    lateral = waves.lateral[i]
  const f = k * (dx * x + dz * z) - waves.phase[i]
  const c = Math.cos(f),
    s = Math.sin(f)
  out[OFFSET_X] = lateral * dx * c
  out[OFFSET_Y] = amplitude * s
  out[OFFSET_Z] = lateral * dz * c
  out[NORMAL_X] = dx * k * amplitude * c
  out[NORMAL_Y] = k * lateral * s
  out[NORMAL_Z] = dz * k * amplitude * c
}
/** One wave's terms, rewritten by each wave of `offset` and `normal`. */
const terms = new Float64Array(TERM_COUNT)

/**
 * A set of trochoidal waves, clocked by `setTime`. Per wave `i`: its direction `(dx, dz)`, its wave
 * number `k`, its amplitude `A` and its lateral amplitude `Q·A`, where the steepnesses are scaled
 * so that `Σ Qᵢ·Aᵢ·kᵢ ≤ 1` (crests never loop over).
 */
export class Waves {
  /** Number of waves in the sum. */
  readonly count: number
  /** Normalised x component of each wave direction. */
  readonly dirX: Float64Array
  /** Normalised z component of each wave direction. */
  readonly dirZ: Float64Array
  /** Wave number of each wave, in radians per metre. */
  readonly k: Float64Array
  /** Vertical amplitude of each wave, in metres. */
  readonly amplitude: Float64Array
  /** Normalised lateral amplitude of each wave, in metres. */
  readonly lateral: Float64Array
  /** Angular speed and phase at `t = 0` of each wave. */
  private readonly omega: Float64Array
  private readonly phase0: Float64Array
  /** Each wave's phase at the time set, in [0, 2π): the only per-time state. */
  readonly phase: Float64Array
  /** Highest point the sum can reach above rest: `Σ Aᵢ`. */
  readonly crest: number

  constructor(specs: readonly WaveSpec[]) {
    const n = (this.count = specs.length)
    ;[this.dirX, this.dirZ, this.k, this.amplitude, this.lateral, this.omega, this.phase0] =
      Array.from({ length: 7 }, () => new Float64Array(n))
    this.phase = new Float64Array(n)
    let steep = 0
    for (const spec of specs) {
      const length = length2(spec.direction[0], spec.direction[1])
      if (!(spec.wavelength > 0) || !(spec.amplitude >= 0) || !(length > 0))
        throw new RangeError('Waves: a wave needs a direction, a wavelength and an amplitude.')
      if (!(spec.steepness >= 0 && spec.steepness <= 1))
        throw new RangeError('Waves: steepness is between 0 and 1.')
      steep += spec.amplitude > 0 ? spec.steepness : 0
    }
    const scale = steep > 1 ? 1 / steep : 1
    const direction = new Float64Array(2)
    specs.forEach((spec, i) => {
      direction[0] = spec.direction[0]
      direction[1] = spec.direction[1]
      normalizeVector2(direction)
      this.dirX[i] = direction[0]
      this.dirZ[i] = direction[1]
      this.k[i] = TAU / spec.wavelength
      this.amplitude[i] = spec.amplitude
      // Qᵢ·Aᵢ·kᵢ = steepnessᵢ × scale: the lateral amplitude Qᵢ·Aᵢ follows.
      this.lateral[i] = spec.amplitude > 0 ? (spec.steepness * scale) / this.k[i] : 0
      this.omega[i] = Math.sqrt(WAVE_GRAVITY * this.k[i])
      this.phase0[i] = spec.phase ?? 0
    })
    this.crest = this.amplitude.reduce((a, b) => a + b, 0)
    this.setTime(0)
  }

  /** `Σ Qᵢ·Aᵢ·kᵢ` after normalisation: 1 at most. */
  get steepness() {
    let sum = 0
    for (let i = 0; i < this.count; i++) sum += this.lateral[i] * this.k[i]
    return sum
  }

  /** Each wave's phase at `t` seconds, reduced to [0, 2π) in double precision. */
  phasesAt(t: number, out: Float64Array) {
    for (let i = 0; i < this.count; i++) {
      const phase = (this.omega[i] * t + this.phase0[i]) % TAU
      out[i] = phase < 0 ? phase + TAU : phase
    }
    return out
  }

  /** Clocks the waves at `t` seconds; the previous frame's surface is `setTime(t - dt)`. */
  setTime(t: number) {
    this.phasesAt(t, this.phase)
  }

  /** Displacement `[x, y, z]` of the rest point `(x, 0, z)`, into `out`. */
  offset(x: number, z: number, out: Float64Array | number[]) {
    let ox = 0,
      oy = 0,
      oz = 0
    for (let i = 0; i < this.count; i++) {
      waveTerms(this, i, x, z, terms)
      ox += terms[OFFSET_X]
      oy += terms[OFFSET_Y]
      oz += terms[OFFSET_Z]
    }
    out[0] = ox
    out[1] = oy
    out[2] = oz
    return out
  }

  /**
   * The box every displacement of a rest point of the rectangle `[x0, x1] × [z0, z1]` lies in, its
   * least corner then its greatest, into `out`: per wave, its phase spans the rectangle's reach
   * along its direction, over which its sine and cosine keep within the least and greatest of their
   * ends and of the crests and troughs the span holds; the sum of the waves' boxes holds the sum.
   * `count` waves are summed, the first ones: what a record sized for fewer draws.
   */
  displacementBox(
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    out: Float64Array | number[],
    count = this.count,
  ) {
    out.fill(0, 0, 6)
    for (let i = 0; i < Math.min(count, this.count); i++) {
      const dx = this.dirX[i],
        dz = this.dirZ[i],
        k = this.k[i],
        lateral = this.lateral[i]
      const near = Math.min(dx * x0, dx * x1) + Math.min(dz * z0, dz * z1),
        far = Math.max(dx * x0, dx * x1) + Math.max(dz * z0, dz * z1)
      trigSpan(k * near - this.phase[i], k * far - this.phase[i], spans)
      const across = lateral * dx,
        along = lateral * dz,
        up = this.amplitude[i]
      out[0] += Math.min(across * spans[0], across * spans[1])
      out[3] += Math.max(across * spans[0], across * spans[1])
      out[2] += Math.min(along * spans[0], along * spans[1])
      out[5] += Math.max(along * spans[0], along * spans[1])
      out[1] += up * spans[2]
      out[4] += up * spans[3]
    }
    return out
  }

  /** Unit normal `[x, y, z]` of the surface at the rest point `(x, z)`, into `out`. */
  normal(x: number, z: number, out: Float64Array | number[]) {
    let nx = 0,
      ny = 1,
      nz = 0
    for (let i = 0; i < this.count; i++) {
      waveTerms(this, i, x, z, terms)
      nx -= terms[NORMAL_X]
      ny -= terms[NORMAL_Y]
      nz -= terms[NORMAL_Z]
    }
    out[0] = nx
    out[1] = ny
    out[2] = nz
    normalizeVector3(out)
    return out
  }
}
