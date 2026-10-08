/**
 * WHAT THE SWITCH READS OF EACH ROOT, kept from one view to the next (`plan.ts`, `watch.ts`): the
 * section's baked meshes by mesh number, and per root its entry, radius and the two switch depths,
 * taken again only when the root, its world's linear part or the focal length changes. One table
 * per holder — a plan, a watch —, so both read the same numbers through the same functions.
 */
import { length3, transformAffinePoint } from '../../../math/src/vector/vector.ts'
import { resized } from '../../../math/src/sequence/resized.ts'
import { maxStretch } from '../../../math/src/projection/projectionOracles.ts'
import {
  impostorMeshBaked,
  type ImpostorMaps,
  type ImpostorMesh,
  type ImpostorSection,
} from '../contracts/impostor.ts'
import {
  impostorRadius,
  impostorSwitchOf,
  impostorTexelDepth,
  impostorTriangleDepth,
} from './switch.ts'
import type { ImpostorRoot } from './plan.ts'

/** The section's baked meshes, keyed by their compiled mesh number; refused entries are left out. */
export function impostorBakedByMesh(
  section: ImpostorSection | undefined,
): Map<number, ImpostorMesh & { maps: ImpostorMaps; frames: number; frameSide: number }> {
  const byMesh: BakedByMesh = new Map()
  if (section)
    for (const mesh of section.meshes) if (impostorMeshBaked(mesh)) byMesh.set(mesh.mesh, mesh)
  return byMesh
}

/** Baked meshes by mesh number: each entry holds the maps, frames and frame side the card reads. */
type BakedByMesh = ReturnType<typeof impostorBakedByMesh>
/** The same, read by a root's mesh number, which a root no impostor may replace lacks. */
export type BakedLookup = ReadonlyMap<
  number | undefined,
  NonNullable<ReturnType<BakedByMesh['get']>>
>
const EMPTY_MESHES: BakedLookup = new Map()
/** The section's baked meshes, built once per section: the plan runs every frame, the map does not. */
const bakedBySection = new WeakMap<ImpostorSection, BakedLookup>()
export function bakedLookup(section: ImpostorSection | undefined): BakedLookup {
  if (!section) return EMPTY_MESHES
  let byMesh = bakedBySection.get(section)
  if (!byMesh) bakedBySection.set(section, (byMesh = impostorBakedByMesh(section)))
  return byMesh
}

/** The pivot's view-space point, reused: the plan runs every image. */
export const point = /* @__PURE__ */ new Float64Array(3)

/**
 * Whether the switch holds for a pivot at view-space point `v`. The two depths of `switch.ts` hold
 * on the view axis; at view depth `z` and distance `d` the projection `f·(x, y)/z` stretches a
 * displacement at the pivot by at most `f·d/z²` (its Jacobian's largest singular value, along the
 * image radius) and an area by `f²·d/z³`, against `f/z` and `f²/z²` on the axis. So the atlas is
 * sharp from `2R·f·d/z² ≤ r_f` ⇔ `z·(z/d) ≥ z_tex`, and the root outnumbers its pixels from
 * `T ≥ c·π·R²·f²·d/z³` ⇔ `z·√(z/d) ≥ z_tri`; on the axis both read `z ≥ z_s`, bit for bit. A pivot
 * behind the eye is read as its mirror in front: `z = |v_z|`.
 */
export function switchesAt(texelDepth: number, triangleDepth: number, v: Float64Array) {
  const depth = Math.abs(v[2]),
    cosine = depth / length3(v[0], v[1], v[2])
  return depth * cosine >= texelDepth && depth * Math.sqrt(cosine) >= triangleDepth
}

export type BakedEntry = NonNullable<ReturnType<BakedLookup['get']>>

/**
 * WHAT THE SWITCH READS OF A ROOT THAT THE VIEW DOES NOT MOVE: its baked entry, its radius `R` —
 * the object radius times the largest stretch of its world's linear part — and the two depths
 * `z_tex`, `z_tri` at the focal length. A frame recomputes them only for a root whose world turned
 * or scaled, or all of them for a new focal length; every other root costs its pivot's view depth
 * alone. The numbers are the very ones the switch computed each frame before — the same functions
 * on the same inputs —, so every verdict is the same, bit for bit.
 */
export type SwitchTable = {
  roots: readonly ImpostorRoot[]
  section: ImpostorSection | undefined
  focal: number
  /** The root each rank held when its numbers were taken, and its entry; none where no impostor
   *  may replace it. */
  held: (ImpostorRoot | undefined)[]
  entries: (BakedEntry | undefined)[]
  /** The nine linear numbers of the world each radius was taken from. */
  linear: Float64Array
  radius: Float64Array
  texelDepth: Float64Array
  triangleDepth: Float64Array
  /** The focal length each root's depths were taken at: a new one retakes a root's as it is read. */
  depthFocal: Float64Array
}
const tables = new WeakMap<object, SwitchTable>()
const LINEAR = [0, 1, 2, 4, 5, 6, 8, 9, 10]

/** `holder`'s table, made again for another root list or section; a new focal length retakes the
 *  depths it scales root by root, as each is read (`rootSwitch`). */
export function switchTable(
  holder: object,
  roots: readonly ImpostorRoot[],
  section: ImpostorSection | undefined,
  focal: number,
) {
  let table = tables.get(holder)
  if (table && table.roots === roots && table.section === section)
    if (table.held.length !== roots.length) resize(table, roots.length)
  if (!table || table.roots !== roots || table.section !== section) {
    const n = roots.length
    table = {
      roots,
      section,
      focal,
      held: new Array<ImpostorRoot | undefined>(n),
      entries: new Array<BakedEntry | undefined>(n),
      // NaN equals nothing: every root takes its numbers on the first frame.
      linear: new Float64Array(n * LINEAR.length).fill(NaN),
      radius: new Float64Array(n),
      texelDepth: new Float64Array(n),
      triangleDepth: new Float64Array(n),
      depthFocal: new Float64Array(n).fill(NaN),
    }
    tables.set(holder, table)
  }
  table.focal = focal
  return table
}

/** `table` at `n` roots, the numbers of those it held kept: a list grown in place reads only the
 *  roots appended. The arrays are the capacity (`resized`); a root past `n` is taken again from
 *  nothing should it come back (`rootSwitch`). */
function resize(table: SwitchTable, n: number) {
  table.held.length = table.entries.length = n
  table.linear = resized(table.linear, n * LINEAR.length, NaN)
  table.radius = resized(table.radius, n)
  table.texelDepth = resized(table.texelDepth, n)
  table.triangleDepth = resized(table.triangleDepth, n)
  table.depthFocal = resized(table.depthFocal, n, NaN)
}

/** The two switch depths of a root of radius `table.radius[rank]` at the table's focal length. */
function depthsOf(table: SwitchTable, rank: number, entry: BakedEntry) {
  const radius = table.radius[rank]
  table.depthFocal[rank] = table.focal
  table.texelDepth[rank] = impostorTexelDepth(radius, entry.frameSide, table.focal)
  table.triangleDepth[rank] = impostorTriangleDepth(
    radius,
    entry.rootTriangles,
    entry.coverage as number,
    table.focal,
  )
}

/** Whether the nine linear numbers held from `at` are the world's. */
function sameLinear(held: Float64Array, at: number, world: ArrayLike<number>) {
  for (let k = 0; k < LINEAR.length; k++) if (held[at + k] !== world[LINEAR[k]]) return false
  return true
}

/**
 * The entry of the root at `rank` with its radius and depths, taken again only when the root or
 * the linear part of its world changed; `undefined` for a root no impostor may replace.
 */
function rootSwitch(table: SwitchTable, rank: number, root: ImpostorRoot, byMesh: BakedLookup) {
  if (table.held[rank] !== root) {
    table.held[rank] = root
    const entry = byMesh.get(root.mesh)
    // A refused switch input does not depend on the placement: the entry alone decides.
    table.entries[rank] = entry && impostorSwitchOf(entry) ? entry : undefined
    table.linear[rank * LINEAR.length] = NaN
  }
  const entry = table.entries[rank]
  if (!entry) return undefined
  const world = root.world.elements,
    at = rank * LINEAR.length
  if (!sameLinear(table.linear, at, world)) {
    // Taken before the copy: a world `maxStretch` refuses throws again on the next frame, as it did.
    table.radius[rank] = impostorRadius(entry.objectRadius as number, maxStretch(world))
    for (let k = 0; k < LINEAR.length; k++) table.linear[at + k] = world[LINEAR[k]]
    depthsOf(table, rank, entry)
  } else if (table.depthFocal[rank] !== table.focal) depthsOf(table, rank, entry)
  return entry
}

/**
 * Root `rank` read at `view`: its entry when it may take a card (`carded`), its pivot's view-space
 * point then in `point`; `undefined` for a root no impostor may replace. The switch is then
 * `switchesAt(table.texelDepth[rank], table.triangleDepth[rank], point)`.
 */
export function readRoot(
  table: SwitchTable,
  rank: number,
  root: ImpostorRoot,
  byMesh: BakedLookup,
  view: ArrayLike<number>,
  carded = true,
) {
  const entry = carded ? rootSwitch(table, rank, root, byMesh) : undefined
  if (!entry) return undefined
  const world = root.world.elements
  transformAffinePoint(point, view, world[12], world[13], world[14])
  return entry
}
