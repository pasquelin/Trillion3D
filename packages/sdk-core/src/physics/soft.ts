import { EngineError } from '../contracts/cache.ts'
import type { Geometry } from '../world/geometry/geometry.ts'
import { crossVector3, length3 } from '../../../math/src/vector/vector.ts'
import { readPoints } from '../world/geometry/bounds.ts'
import { GRAVITY_PRESETS, PHYSICS_STEP } from './options.ts'
import type { PhysicsBodyOptions, PhysicsOption } from './options.ts'
import { SOFT_VERTEX_WORDS } from './softLayout.ts'
import { softSettings } from './softSettings.ts'
import { SQRT3, TAU } from '../../../math/src/constants.ts'

/** A soft body: a cloth (its triangles, open), a rope (its vertices, each joined to the next), or
 *  a volume (its closed triangles, held up by the gas inside). */
export type SoftBodyType = 'cloth' | 'rope' | 'volume'

/** What `obj.physics` accepts for a soft body: its vertices are simulated one by one. Its matter
 *  and pull as a rigid body's; no angular damping, shape, sensor, CCD nor debris. */
export interface SoftBodyCommon extends Pick<
  PhysicsBodyOptions,
  'friction' | 'restitution' | 'gravityScale'
> {
  /** The share of its vertices' speed lost per second, `dv/dt = −c·v`, 0 and up. Left out,
   *  `SOFT_DAMPING`: a hundredth of it each step of 60 Hz, 0.603.
   *  @defaultValue { linear: SOFT_DAMPING } */
  damping?: { linear?: number }
  /** Indices of the geometry's vertices held where they are: a flag's pole, a rope's hook.
   *  @defaultValue [] */
  pins?: readonly number[]
  /** Kilograms, spread over the vertices by the area (a rope: the length) each one holds; left
   *  out, `SOFT_AREAL_DENSITY` per m² (a rope: `SOFT_LINEAR_DENSITY` per m). */
  mass?: number
  /** How much an edge gives when pulled, m/N (the inverse of its stiffness): 0 never stretches.
   *  @defaultValue 0 */
  stretch?: number
  /** How much it gives when folded, rad/(N·m) (a rope: m/N); `Infinity` folds freely. A cloth's
   *  or a volume's fold is never stiffer than the solver resolves in a substep — the compliance of
   *  the four vertices it moves, `h²·Σ wᵢ|∇Cᵢ|²`: 7 to 80 for cotton in 6 cm squares —; stiffer,
   *  it is held at that, which would otherwise add energy (a stiff flag with little air flapping
   *  for ever).
   *  @defaultValue Infinity */
  bend?: number
}
/** A volume's options: a closed mesh held up by the gas inside. */
export interface SoftVolumeOptions extends SoftBodyCommon {
  /** A volume. */ type: 'volume'
  /** The gas's pressure above the air's at rest, Pa; squeezed, it rises as the volume falls
   *  (Boyle's law). The triangles must face out. Left out, the pressure that rests the volume's
   *  weight on `SOFT_FOOTPRINT` of its mean cross-section, or the most its skin holds if less.
   *  Refused past the most its skin holds within a tenth of its rest volume. */
  pressure?: number
}
/** A soft body's options: a cloth, a rope, or a volume with the pressure of its gas. */
export type SoftBodyOptions = (SoftBodyCommon & { type: 'cloth' | 'rope' }) | SoftVolumeOptions

/** A medium woven cotton, kg/m²: textile weights run 0.15 to 0.25. A cloth falls the same at any
 *  mass; it weighs against its pins and what it meets. A volume's skin is taken as such a cloth. */
export const SOFT_AREAL_DENSITY = 0.2
/** A 10 mm polyamide rope, kg/m: makers' tables give 0.06 to 0.07. */
export const SOFT_LINEAR_DENSITY = 0.065
/**
 * Declared: the share of its mean cross-section — a quarter of its area, for any convex shape
 * (Cauchy) — a volume at rest on the ground sags onto, its gas pressing its weight there. Its
 * default pressure is then `4·m·g / (share·area)`: 31 Pa for a skin of `SOFT_AREAL_DENSITY`. Half
 * the share, twice the pressure. It never passes the most its skin holds within a tenth of its rest volume.
 */
export const SOFT_FOOTPRINT = 0.25

/** Declared: the share of its speed a soft body that declares no damping loses each step of
 *  `PHYSICS_STEP` (a frame of 60 Hz). */
const SOFT_STEP_LOSS = 0.01
/**
 * The damping of a soft body that declares none, per second (`dv/dt = −c·v`): the rate that takes
 * `SOFT_STEP_LOSS` of its speed each step of 60 Hz, `−ln(0.99)·60`, 0.603, whatever its type, mass
 * or size. The physics module damps each of its five substeps by `1 − c·h`: 0.99 a step to within 2e-5, and the
 * same share a second at any step. Its swing settles within seconds; it falls at most at `g / c`,
 * 16.3 m/s.
 */
export const SOFT_DAMPING = -Math.log(1 - SOFT_STEP_LOSS) / PHYSICS_STEP

/** Declared: a volume keeps within a tenth of its rest volume, or its pressure is refused. */
const SOFT_MAX_SWELL = 0.1
/** The physics module's substeps of a soft body per step: `SoftBodyCreationSettings::mNumIterations`, its default. */
const SOFT_SUBSTEPS = 5

/**
 * The most gauge pressure, Pa, a volume's skin holds within `SOFT_MAX_SWELL`, simulated in fixed
 * steps of `step` seconds. The gas stretches the skin to `P·R / 2` N/m, R the radius of a sphere
 * of its area (half the sphere, pressed by `P·πR²`, is held along its rim of `2πR`), `1/√3` of
 * which pulls on each edge per metre of its length. An edge gives under it by its compliance:
 * `stretch`, plus the solver's own, `dt² / m` for a substep `dt` and a vertex of `m` kg (how far a
 * newton moves the vertex within a substep before its edges are projected). The stretch it
 * reaches swells the volume by its cube. Measured on
 * spheres of 0.1 to 2 m, 8 to 32 segments, weightless: at this pressure they keep within 8 %, at
 * twice they swell by 10 to 14 %.
 */
function heldPressure(vertexMass: number, area: number, stretch: number, step: number) {
  const dt = step / SOFT_SUBSTEPS,
    radius = Math.sqrt(area / (2 * TAU))
  const give = ((stretch + dt ** 2 / vertexMass) * radius) / (2 * SQRT3)
  return (Math.cbrt(1 + SOFT_MAX_SWELL) - 1) / give
}

/** A soft body's options once read: every default filled. */
export interface SoftSettings {
  /** What it is. */ type: SoftBodyType
  /** The geometry's vertices held in place. */ pins: readonly number[]
  /** Kilograms, `undefined` for the default density's. */ mass: number | undefined
  /** m/N. */ stretch: number
  /** rad/(N·m), a rope's m/N. */ bend: number
  /** Pa; `undefined` for a volume's default (`SOFT_FOOTPRINT`). */
  pressure: number | undefined
}

const SOFT_TYPES: readonly string[] = ['cloth', 'rope', 'volume']
/** Whether `type` names a soft body. */
export const isSoftType = (type: unknown): type is SoftBodyType =>
  SOFT_TYPES.includes(type as string)

/** Whether a soft body of `type` is drawn on both faces, whatever side its material declares: a
 *  cloth is an open sheet, and either face turns to the camera as it folds and falls. A volume is
 *  closed, its inside never seen; a rope draws no face of its own. */
export const drawnTwoSided = (type: SoftBodyType | null | undefined) => type === 'cloth'

/** The soft body `option` asks for, read; `null` when it asks for a rigid one. */
export const softOf = (option: PhysicsOption) =>
  typeof option === 'object' && isSoftType(option.type)
    ? softSettings(option as SoftBodyOptions)
    : null

/** A soft body ready for the SOFT command, and how the geometry's vertices map onto its own. */
export interface SoftRecord {
  /** `x, y, z, mass` per simulated vertex, in the geometry's frame; a pin's mass is 0. */
  vertices: Float32Array
  indices: Uint32Array
  /** Each geometry vertex's simulated vertex: vertices at one position are one. */
  map: Uint32Array
  /** The gas's pressure at rest, Pa; 0 without gas. */
  pressure: number
}

type Scale = { x: number; y: number; z: number }

/**
 * The simulated vertices of `geometry`: those at one position welded into one (a sphere's seam
 * and poles would otherwise tear), their triangles (none for a rope: its vertices in order), and
 * their masses from the scaled area — a rope's length — each holds, or `settings.mass` spread so,
 * and a volume's pressure, what its skin holds reckoned at `step`, the page's fixed step.
 */
export function softBodyOf(
  geometry: Geometry,
  scale: Scale,
  settings: SoftSettings,
  step: number,
): SoftRecord {
  const source = Float32Array.from(readPoints(geometry.getAttribute('position')))
  const count = source.length / 3
  const map = new Uint32Array(count)
  const at = new Map<string, number>()
  const kept: number[] = []
  for (let v = 0; v < count; v++) {
    const key = `${source[v * 3]},${source[v * 3 + 1]},${source[v * 3 + 2]}`
    let welded = at.get(key)
    if (welded === undefined) at.set(key, (welded = kept.push(v) - 1))
    map[v] = welded
  }
  const corners = geometry.index ? geometry.index.array : Uint32Array.from(map.keys())
  const indices: number[] = []
  if (settings.type !== 'rope')
    for (let t = 0; t + 2 < corners.length; t += 3) {
      const [a, b, c] = [map[corners[t]], map[corners[t + 1]], map[corners[t + 2]]]
      if (a !== b && b !== c && a !== c) indices.push(a, b, c)
    }
  if (settings.type === 'rope' ? kept.length < 2 : !indices.length)
    throw new EngineError('PHYSICS_FAILED', `A soft ${settings.type} needs more vertices.`)
  const vertices = new Float32Array(kept.length * SOFT_VERTEX_WORDS)
  kept.forEach((v, i) => vertices.set(source.subarray(v * 3, v * 3 + 3), i * SOFT_VERTEX_WORDS))
  const measure = spreadMass(vertices, indices, kept.length, scale)
  const density = settings.type === 'rope' ? SOFT_LINEAR_DENSITY : SOFT_AREAL_DENSITY
  const factor = settings.mass === undefined ? density : settings.mass / measure
  for (let i = 0; i < kept.length; i++) vertices[i * SOFT_VERTEX_WORDS + 3] *= factor
  const held =
    settings.type === 'volume'
      ? heldPressure((factor * measure) / kept.length, measure, settings.stretch, step)
      : 0
  const pressure =
    settings.pressure ?? Math.min((4 * factor * GRAVITY_PRESETS.earth) / SOFT_FOOTPRINT, held)
  if (pressure > held)
    throw new RangeError(
      `A soft volume's pressure ${pressure} Pa swells it past a tenth: its skin holds ${held.toFixed(1)}.`,
    )
  for (const pin of settings.pins) {
    if (!(Number.isInteger(pin) && pin >= 0 && pin < count))
      throw new RangeError(`A soft body's pin ${pin} names no vertex of its ${count}.`)
    vertices[map[pin] * SOFT_VERTEX_WORDS + 3] = 0
  }
  return { vertices, indices: Uint32Array.from(indices), map, pressure }
}

const edgeU = new Float64Array(3),
  edgeV = new Float64Array(3)

/** Writes in each vertex's mass word the scaled area (no triangle: length) it holds; returns the
 *  whole. Each scaled edge is written into a scratch vector, the cross product into the first:
 *  the operations of fresh arrays, in their order, with no array made per triangle. */
function spreadMass(vertices: Float32Array, indices: number[], count: number, s: Scale) {
  const scale = [s.x, s.y, s.z]
  /** `out` = the scaled edge from vertex `a` to vertex `b`. */
  const edge = (out: Float64Array, a: number, b: number) => {
    for (let k = 0; k < 3; k++)
      out[k] =
        vertices[b * SOFT_VERTEX_WORDS + k] * scale[k] -
        vertices[a * SOFT_VERTEX_WORDS + k] * scale[k]
    return out
  }
  const share = (i: number, amount: number) => (vertices[i * SOFT_VERTEX_WORDS + 3] += amount)
  let whole = 0
  if (!indices.length)
    for (let i = 0; i + 1 < count; i++) {
      const u = edge(edgeU, i, i + 1),
        length = length3(u[0], u[1], u[2])
      share(i, length / 2)
      share(i + 1, length / 2)
      whole += length
    }
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t], indices[t + 1], indices[t + 2]]
    const n = crossVector3(edgeU, edge(edgeU, a, b), edge(edgeV, a, c)),
      area = length3(n[0], n[1], n[2]) / 2
    share(a, area / 3)
    share(b, area / 3)
    share(c, area / 3)
    whole += area
  }
  if (!(whole > 0)) throw new EngineError('PHYSICS_FAILED', 'A soft body has no area or length.')
  return whole
}
