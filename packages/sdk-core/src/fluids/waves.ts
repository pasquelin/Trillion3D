/**
 * The one wave model of the engine: a sum of Gerstner waves. Buoyancy reads it on the CPU (the
 * physics worker); the water surface's shader code will be generated from the same numbers
 * (#422), so nothing about a wave is written twice. A Gerstner wave moves a
 * point of the rest plane both up and sideways, towards the crest, so the height above a world
 * position is found by iterating on the rest position (`surface.ts`). The previous
 * frame's surface is the same formula at `t - dt`: nothing is stored.
 */

/** One wave as a scene declares it. */
export interface WaveSpec {
  /** Horizontal direction of travel `[x, z]`; normalised here. */
  direction: readonly [number, number];
  /** Metres from crest to crest. */
  wavelength: number;
  /** Metres from rest to crest. */
  amplitude: number;
  /** 0 (a sine wave) to 1 (the sharpest crest that does not loop); normalised over the sum. */
  steepness: number;
  /** Phase at `t = 0`, radians. */
  phase?: number;
}

/** Deep-water gravity, m/s²: a wave's angular speed is `sqrt(GRAVITY × k)`. */
const WAVE_GRAVITY = 9.81;
const TAU = Math.PI * 2;

/**
 * A set of Gerstner waves, clocked by `setTime`. Per wave `i`: its direction `(dx, dz)`, its wave
 * number `k`, its amplitude `A` and its lateral amplitude `Q·A`, where the steepnesses are scaled
 * so that `Σ Qᵢ·Aᵢ·kᵢ ≤ 1` (crests never loop over).
 */
export class Waves {
  readonly count: number;
  readonly dirX: Float64Array;
  readonly dirZ: Float64Array;
  readonly k: Float64Array;
  readonly amplitude: Float64Array;
  readonly lateral: Float64Array;
  /** Angular speed and phase at `t = 0` of each wave. */
  private readonly omega: Float64Array;
  private readonly phase0: Float64Array;
  /** Each wave's phase at the time set, in [0, 2π): the only per-time state. */
  readonly phase: Float64Array;
  /** Highest point the sum can reach above rest: `Σ Aᵢ`. */
  readonly crest: number;

  constructor(specs: readonly WaveSpec[]) {
    const n = (this.count = specs.length);
    [this.dirX, this.dirZ, this.k, this.amplitude, this.lateral, this.omega, this.phase0] =
      Array.from({ length: 7 }, () => new Float64Array(n));
    this.phase = new Float64Array(n);
    let steep = 0;
    for (const spec of specs) {
      const length = Math.hypot(spec.direction[0], spec.direction[1]);
      if (!(spec.wavelength > 0) || !(spec.amplitude >= 0) || !(length > 0))
        throw new RangeError('Waves: a wave needs a direction, a wavelength and an amplitude.');
      if (!(spec.steepness >= 0 && spec.steepness <= 1))
        throw new RangeError('Waves: steepness is between 0 and 1.');
      steep += spec.amplitude > 0 ? spec.steepness : 0;
    }
    const scale = steep > 1 ? 1 / steep : 1;
    specs.forEach((spec, i) => {
      const length = Math.hypot(spec.direction[0], spec.direction[1]);
      this.dirX[i] = spec.direction[0] / length;
      this.dirZ[i] = spec.direction[1] / length;
      this.k[i] = TAU / spec.wavelength;
      this.amplitude[i] = spec.amplitude;
      // Qᵢ·Aᵢ·kᵢ = steepnessᵢ × scale: the lateral amplitude Qᵢ·Aᵢ follows.
      this.lateral[i] = spec.amplitude > 0 ? (spec.steepness * scale) / this.k[i] : 0;
      this.omega[i] = Math.sqrt(WAVE_GRAVITY * this.k[i]);
      this.phase0[i] = spec.phase ?? 0;
    });
    this.crest = this.amplitude.reduce((a, b) => a + b, 0);
    this.setTime(0);
  }

  /** `Σ Qᵢ·Aᵢ·kᵢ` after normalisation: 1 at most. */
  get steepness() {
    let sum = 0;
    for (let i = 0; i < this.count; i++) sum += this.lateral[i] * this.k[i];
    return sum;
  }

  /** Each wave's phase at `t` seconds, reduced to [0, 2π) in double precision. */
  phasesAt(t: number, out: Float64Array) {
    for (let i = 0; i < this.count; i++) {
      const phase = (this.omega[i] * t + this.phase0[i]) % TAU;
      out[i] = phase < 0 ? phase + TAU : phase;
    }
    return out;
  }

  /** Clocks the waves at `t` seconds; the previous frame's surface is `setTime(t - dt)`. */
  setTime(t: number) {
    this.phasesAt(t, this.phase);
  }

  /** Displacement `[x, y, z]` of the rest point `(x, 0, z)`, into `out`. */
  offset(x: number, z: number, out: Float64Array | number[]) {
    let ox = 0,
      oy = 0,
      oz = 0;
    for (let i = 0; i < this.count; i++) {
      const f = this.k[i] * (this.dirX[i] * x + this.dirZ[i] * z) - this.phase[i];
      const c = Math.cos(f);
      ox += this.lateral[i] * this.dirX[i] * c;
      oy += this.amplitude[i] * Math.sin(f);
      oz += this.lateral[i] * this.dirZ[i] * c;
    }
    out[0] = ox;
    out[1] = oy;
    out[2] = oz;
    return out;
  }

  /** Unit normal `[x, y, z]` of the surface at the rest point `(x, z)`, into `out`. */
  normal(x: number, z: number, out: Float64Array | number[]) {
    let nx = 0,
      ny = 1,
      nz = 0;
    for (let i = 0; i < this.count; i++) {
      const f = this.k[i] * (this.dirX[i] * x + this.dirZ[i] * z) - this.phase[i];
      const ka = this.k[i] * this.amplitude[i],
        c = Math.cos(f);
      nx -= this.dirX[i] * ka * c;
      ny -= this.k[i] * this.lateral[i] * Math.sin(f);
      nz -= this.dirZ[i] * ka * c;
    }
    const length = Math.hypot(nx, ny, nz);
    out[0] = nx / length;
    out[1] = ny / length;
    out[2] = nz / length;
    return out;
  }
}
