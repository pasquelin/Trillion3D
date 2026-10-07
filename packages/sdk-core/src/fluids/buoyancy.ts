/**
 * The water of one physics step. The module lists the pieces of the bodies that reach the water
 * (`jolt_water_query`) and gives each the wave model's exact height at its centre and the slope
 * of four surface points around it (`jolt_water_planes`); the step's BUOYANCY command carries the
 * water and every plane back to it, which pushes the bodies in one batched call.
 * A body floats on its own when its density is below the water's: the push is the water's weight
 * displaced, and the physics module measures the displaced volume exactly.
 */
import { nextPow2 } from '../../../math/src/scalar/integers.ts'
import { BUOYANCY_WORDS, OP, PLANE_WORDS } from '../physics/layout.ts'
import { Waves, type WaveSpec } from './waves.ts'

/** Fresh water, kg/m³. */
const WATER_DENSITY = 1000
/**
 * Declared drags, the quadratic coefficients of the water's resistance on a body's linear and
 * angular speed. The linear one is
 * a drag coefficient: 0.5 is a sphere's (0.47), between a streamlined body (0.04) and a cube face
 * on (1.05). The angular one damps a body's turning in the water. Neither changes where a body
 * floats — the depth at rest follows from the densities alone — only how fast it settles there
 * and how fast a current carries it: doubling one roughly halves the time a body takes to settle.
 */
const LINEAR_DRAG = 0.5,
  ANGULAR_DRAG = 0.05
/**
 * Slices per smallest sample square. A piece's plane is fitted over a square of its own half
 * sides, never smaller than the slice length over this: the fitted slope is the tangent's times
 * `sin(kh) / kh`, so at `kh = π / 25` a thin piece reads the shortest wave's slope within 0.3 %,
 * the longer waves' closer still. Sensitivity: only pieces thinner than that square see it.
 */
const SAMPLES_PER_SLICE = 25

/** A body of water the bodies float in, as `world.physics.water` takes it. */
export interface WaterSpec {
  /** The trochoidal waves of the surface; none for still water. */
  waves: WaveSpec[]
  /** Height of the surface at rest, metres. */
  level: number
  /** kg/m³; fresh water's 1000 by default. */
  density?: number
  /** Quadratic drag coefficient: how fast a body settles, never where; 0.5 by default. */
  linearDrag?: number
  /** How much the water damps a body's turning; 0.05 by default. */
  angularDrag?: number
  /** Velocity of the water (a river's current), m/s. */
  current?: readonly [number, number, number]
}

/** A water body ready for the steps: its wave model and its resolved settings. */
export interface Water {
  waves: Waves
  level: number
  density: number
  linearDrag: number
  angularDrag: number
  current: readonly [number, number, number]
  /** Smallest half side of a piece's sample square, metres (`SAMPLES_PER_SLICE`). */
  sample: number
}

/** Resolves a declared water body. */
export function createWater(spec: WaterSpec): Water {
  const waves = new Waves(spec.waves)
  return {
    waves,
    level: spec.level,
    density: spec.density ?? WATER_DENSITY,
    linearDrag: spec.linearDrag ?? LINEAR_DRAG,
    angularDrag: spec.angularDrag ?? ANGULAR_DRAG,
    current: spec.current ?? [0, 0, 0],
    // Level water has a level plane over any square: its size is then free, 1 m.
    sample: sliceLength({ waves }) / SAMPLES_PER_SLICE || 1,
  }
}

/** Length past which a single primitive is cut into slices, each with its own plane: half the
 *  shortest wavelength (0 without waves: no slices). */
export function sliceLength(water: Pick<Water, 'waves'>) {
  let shortest = Infinity
  for (let i = 0; i < water.waves.count; i++)
    if (water.waves.amplitude[i] > 0) shortest = Math.min(shortest, Math.PI / water.waves.k[i])
  return Number.isFinite(shortest) ? shortest : 0
}

/**
 * The words of a step: its BUOYANCY command, the planes the module gave the pieces
 * (`waterPlanes.cpp`), then the page's commands. Its buffer grows to the largest step and is then
 * reused: a steady step allocates nothing.
 */
export class StepWords {
  words = new Uint32Array(1024)
  private floats = new Float32Array(this.words.buffer)

  private reserve(count: number) {
    if (count <= this.words.length) return
    this.words = new Uint32Array(nextPow2(count))
    this.floats = new Float32Array(this.words.buffer)
  }

  /** Writes the BUOYANCY command of `water` over `planes` (`PLANE_WORDS` each), then `queued`;
   *  returns the word count. */
  write(water: Water, planes: Uint32Array, queued: Uint32Array | null) {
    this.reserve(BUOYANCY_WORDS + planes.length + (queued?.length ?? 0))
    const w = this.words,
      f = this.floats
    w[0] = OP.buoyancy
    w[1] = planes.length / PLANE_WORDS
    f[2] = water.density
    f[3] = water.linearDrag
    f[4] = water.angularDrag
    f.set(water.current, 5)
    w.set(planes, BUOYANCY_WORDS)
    let length = BUOYANCY_WORDS + planes.length
    if (queued) w.set(queued, (length += queued.length) - queued.length)
    return length
  }
}
