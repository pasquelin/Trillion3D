import { hypot2, hypot3 } from '../math/primitives/hypot.ts'

/**
 * The one wave model of the engine: a sum of trochoidal waves. Buoyancy reads it on the CPU (the
 * physics worker); the water surface's shader code will be generated from the same numbers
 * (#422), so nothing about a wave is written twice. A trochoidal wave moves a
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
const TAU = Math.PI * 2

const QUARTER = Math.PI / 2

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
  const first = Math.ceil(a / QUARTER),
    last = Math.min(Math.floor(b / QUARTER), first + 3)
  for (let j = first; j <= last; j++) {
    const turn = ((j % 4) + 4) % 4
    if (turn === 0) out[1] = 1
    else if (turn === 1) out[3] = 1
    else if (turn === 2) out[0] = -1
    else out[2] = -1
  }
}
/** A cosine's least and greatest then a sine's, rewritten by each wave of `displacementBox`. */
const spans = new Float64Array(4)

/** Doubles of one wave the module's planes read (`jolt_wave_buffer`, `waterPlanes.cpp`):
 *  `direction x, z, wave number, amplitude, lateral amplitude, phase` at the step's time. */
export const WAVE_DOUBLES = 6

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
      const length = hypot2(spec.direction[0], spec.direction[1])
      if (!(spec.wavelength > 0) || !(spec.amplitude >= 0) || !(length > 0))
        throw new RangeError('Waves: a wave needs a direction, a wavelength and an amplitude.')
      if (!(spec.steepness >= 0 && spec.steepness <= 1))
        throw new RangeError('Waves: steepness is between 0 and 1.')
      steep += spec.amplitude > 0 ? spec.steepness : 0
    }
    const scale = steep > 1 ? 1 / steep : 1
    specs.forEach((spec, i) => {
      const length = hypot2(spec.direction[0], spec.direction[1])
      this.dirX[i] = spec.direction[0] / length
      this.dirZ[i] = spec.direction[1] / length
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
      const f = this.k[i] * (this.dirX[i] * x + this.dirZ[i] * z) - this.phase[i]
      const c = Math.cos(f)
      ox += this.lateral[i] * this.dirX[i] * c
      oy += this.amplitude[i] * Math.sin(f)
      oz += this.lateral[i] * this.dirZ[i] * c
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
      const f = this.k[i] * (this.dirX[i] * x + this.dirZ[i] * z) - this.phase[i]
      const ka = this.k[i] * this.amplitude[i],
        c = Math.cos(f)
      nx -= this.dirX[i] * ka * c
      ny -= this.k[i] * this.lateral[i] * Math.sin(f)
      nz -= this.dirZ[i] * ka * c
    }
    const length = hypot3(nx, ny, nz)
    out[0] = nx / length
    out[1] = ny / length
    out[2] = nz / length
    return out
  }
}
