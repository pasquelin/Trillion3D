import type { WaterSpec } from './buoyancy.ts'
import { waveHeight } from './surface.ts'
import { Waves, type WaveSpec } from './waves.ts'

/**
 * The water's surface as the page reads it to draw it (`world.physics.waterSurface`): the wave
 * model buoyancy reads in the physics worker, the same numbers, clocked at the simulation's time.
 */
export class WaterSurface {
  private waves!: Waves
  private declared!: readonly WaveSpec[]
  private rest = 0
  /** Simulated seconds since the water was set: the waves' clock. */
  time = 0

  /** @param spec - The water as `world.physics.water` takes it; a wave out of range throws
   *  `RangeError`, as there. */
  constructor(spec: WaterSpec) {
    this._declare(spec)
  }

  /** The world's water set again (`world.physics.water`): this surface becomes the new one in
   *  place, its clock at 0 s as the worker's, so a mesh it carries (`mesh.waves`) is carried by
   *  the new waves. A wave out of range throws `RangeError` and leaves it as it was. */
  _declare(spec: WaterSpec) {
    const waves = new Waves(spec.waves)
    this.declared = spec.waves
    this.waves = waves
    this.rest = spec.level
    this.time = 0
    return this
  }

  /** Height of the surface at rest, metres. */
  get level() {
    return this.rest
  }

  /** Highest point a crest reaches above `level`, metres. */
  get crest() {
    return this.waves.crest
  }

  /** Clocks the waves at `t` simulated seconds. */
  setTime(t: number) {
    this.time = t
    this.waves.setTime(t)
    return this
  }

  /** Height of the surface above the world point `(x, z)`, metres. */
  height(x: number, z: number) {
    return this.level + waveHeight(this.waves, x, z)
  }

  /** The world point `[x, y, z]` the rest point `(x, level, z)` is carried to, into `out`: a
   *  grid moved point by point is the surface, crests drawn as sharp as the waves are. */
  point(x: number, z: number, out: Float64Array) {
    this.waves.offset(x, z, out)
    out[0] += x
    out[1] += this.level
    out[2] += z
    return out
  }

  /** The declared waves, each phase carried to this time: set again in `world.physics.water`
   *  (whose waves start again at 0 s), the surface goes on from where it is instead of jumping. */
  wavesNow(): WaveSpec[] {
    return this.declared.map((wave, i) => ({ ...wave, phase: this.waves.phase[i] }))
  }

  /** The waves themselves, clocked at `time`: what the GPU deformation stage reads to draw a
   *  mesh the surface carries (`mesh.waves`, #357), the very numbers buoyancy reads. */
  get waveModel(): Waves {
    return this.waves
  }

  /** Unit normal `[x, y, z]` of the surface at the rest point `(x, z)`, into `out`. */
  normal(x: number, z: number, out: Float64Array) {
    this.waves.normal(x, z, out)
    return out
  }
}
