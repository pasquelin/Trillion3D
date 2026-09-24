/**
 * The water's surface as the page reads it to draw it (`world.physics.waterSurface`): the wave
 * model buoyancy reads in the physics worker, the same numbers, clocked at the simulation's time.
 */
import type { WaterSpec } from './buoyancy.ts';
import { waveHeight } from './surface.ts';
import { Waves, type WaveSpec } from './waves.ts';

export class WaterSurface {
  private readonly waves: Waves;
  private readonly declared: readonly WaveSpec[];
  /** Height of the surface at rest, metres. */
  readonly level: number;
  /** Highest point a crest reaches above `level`, metres. */
  readonly crest: number;
  /** Simulated seconds since the water was set: the waves' clock. */
  time = 0;

  /** Throws `RangeError` on a wave out of range, as `world.physics.water` does. */
  constructor(spec: WaterSpec) {
    this.declared = spec.waves;
    this.waves = new Waves(spec.waves);
    this.level = spec.level;
    this.crest = this.waves.crest;
  }

  /** Clocks the waves at `t` simulated seconds. */
  setTime(t: number) {
    this.time = t;
    this.waves.setTime(t);
    return this;
  }

  /** Height of the surface above the world point `(x, z)`, metres. */
  height(x: number, z: number) {
    return this.level + waveHeight(this.waves, x, z);
  }

  /** The world point `[x, y, z]` the rest point `(x, level, z)` is carried to, into `out`: a
   *  grid moved point by point is the surface, crests drawn as sharp as the waves are. */
  point(x: number, z: number, out: Float64Array | number[]) {
    this.waves.offset(x, z, out);
    out[0] += x;
    out[1] += this.level;
    out[2] += z;
    return out;
  }

  /** The declared waves, each phase carried to this time: set again in `world.physics.water`
   *  (whose waves start again at 0 s), the surface goes on from where it is instead of jumping. */
  wavesNow(): WaveSpec[] {
    return this.declared.map((wave, i) => ({ ...wave, phase: this.waves.phase[i] }));
  }

  /** Unit normal `[x, y, z]` of the surface at the rest point `(x, z)`, into `out`. */
  normal(x: number, z: number, out: Float64Array | number[]) {
    return this.waves.normal(x, z, out);
  }
}
