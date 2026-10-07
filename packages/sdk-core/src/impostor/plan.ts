/**
 * THE RUNTIME PLAN of the impostor tier ("When to switch"). The bake gives, per
 * drawn mesh, its three atlas maps and the four numbers the switch reads; this turns them, the
 * placements and the view into the cards to draw and the roots whose clusters the cut suppresses.
 *
 * One card per switched root. A root is identified by its compiled mesh number (`Primitive.mesh`),
 * the same number the compiler keys its `impostors` entries by
 * (`packages/asset-compiler-rust/src/impostor/stage.rs`): there is no second mesh table. The switch is the
 * engine's one oracle (`switch.ts`), never a per-scene constant: `f` is the engine's focal length
 * in pixels (`pixelScaleOf`), `z` the pivot's view depth, each bound taken where the projection
 * magnifies most off the view axis (`switchesAt`), `R`, `T`, `c` and `r_f` only from the baked
 * manifest.
 *
 * Suppression and card are one decision: a root whose switch holds yields a card AND is marked in
 * `switched`, so the cut skips its clusters in the same breath. A card without the skip would draw
 * the object twice; the skip without the card would be a hole (CONTRIBUTING, Streaming rule 1).
 */
import { hypot3 } from '../../../math/src/float/hypot.ts'
import { transformAffinePoint } from '../../../math/src/vector/vector.ts'
import { maxStretch } from '../../../math/src/projection/projectionOracles.ts'
import {
  impostorMeshBaked,
  type ImpostorMap,
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

/** What the plan needs of one root: its compiled mesh number and the world matrix that places it. */
export interface ImpostorRoot {
  /** Compiled mesh number (`Primitive.mesh`); absent on a root no impostor may replace. */
  mesh?: number
  /** World matrix of the placement, column-major (`MatrixElements`). */
  world: { elements: ArrayLike<number> }
}

/** One camera-facing card the runtime draws in place of a switched root's clusters. */
export interface ImpostorCard {
  /** Rank of the root it replaces in the plan's `roots`. */
  root: number
  /** Its compiled mesh number. */
  mesh: number
  /** The root's world matrix, as given. */
  world: ArrayLike<number>
  /** World-space pivot, the bounding-sphere centre under the root's world. */
  centre: [number, number, number]
  /** World-space radius `R = objectRadius × the root's world scale`. */
  radius: number
  /** Frames a side. */
  frames: number
  /** Whether the frames are upper hemi-octahedral. */
  hemi: boolean
  /** The three maps the card samples: colour+coverage, normal+depth, packed ORM. */
  maps: { colourCoverage: ImpostorMap; normalDepth: ImpostorMap; orm: ImpostorMap }
}

/** The cut's verdict: the cards to draw, and the roots whose clusters it suppresses. */
export interface ImpostorPlan {
  /** One card per switched root it read, in the order it read them. */
  cards: ImpostorCard[]
  /** Root ranks the cut suppresses: 1 at a switched root, 0 elsewhere. A plan of some ranks keeps
   *  the verdict of the others as the last plan that read them left it. */
  switched: Uint8Array
  /** The ranks the plan read when given some (`planImpostors`, `ranks`); absent, every rank. */
  visited?: number[]
}

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
type BakedLookup = ReadonlyMap<number | undefined, NonNullable<ReturnType<BakedByMesh['get']>>>
const EMPTY_MESHES: BakedLookup = new Map()
/** The section's baked meshes, built once per section: the plan runs every frame, the map does not. */
const bakedBySection = new WeakMap<ImpostorSection, BakedLookup>()
function bakedLookup(section: ImpostorSection | undefined): BakedLookup {
  if (!section) return EMPTY_MESHES
  let byMesh = bakedBySection.get(section)
  if (!byMesh) bakedBySection.set(section, (byMesh = impostorBakedByMesh(section)))
  return byMesh
}

/** The pivot's view-space point, reused: the plan runs every image. */
const point = /* @__PURE__ */ new Float64Array(3)

/**
 * Whether the switch holds for a pivot at view-space point `v`. The two depths of `switch.ts` hold
 * on the view axis; at view depth `z` and distance `d` the projection `f·(x, y)/z` stretches a
 * displacement at the pivot by at most `f·d/z²` (its Jacobian's largest singular value, along the
 * image radius) and an area by `f²·d/z³`, against `f/z` and `f²/z²` on the axis. So the atlas is
 * sharp from `2R·f·d/z² ≤ r_f` ⇔ `z·(z/d) ≥ z_tex`, and the root outnumbers its pixels from
 * `T ≥ c·π·R²·f²·d/z³` ⇔ `z·√(z/d) ≥ z_tri`; on the axis both read `z ≥ z_s`, bit for bit. A pivot
 * behind the eye is read as its mirror in front: `z = |v_z|`.
 */
function switchesAt(texelDepth: number, triangleDepth: number, v: Float64Array) {
  const depth = Math.abs(v[2]),
    cosine = depth / hypot3(v[0], v[1], v[2])
  return depth * cosine >= texelDepth && depth * Math.sqrt(cosine) >= triangleDepth
}

type BakedEntry = NonNullable<ReturnType<BakedLookup['get']>>

/**
 * WHAT THE SWITCH READS OF A ROOT THAT THE VIEW DOES NOT MOVE: its baked entry, its radius `R` —
 * the object radius times the largest stretch of its world's linear part — and the two depths
 * `z_tex`, `z_tri` at the focal length. A frame recomputes them only for a root whose world turned
 * or scaled, or all of them for a new focal length; every other root costs its pivot's view depth
 * alone. The numbers are the very ones the switch computed each frame before — the same functions
 * on the same inputs —, so every verdict is the same, bit for bit.
 */
type SwitchTable = {
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
const tables = new WeakMap<ImpostorPlan, SwitchTable>()
const LINEAR = [0, 1, 2, 4, 5, 6, 8, 9, 10]

/** The plan's table, made again for another root list or section; a new focal length retakes the
 *  depths it scales root by root, as each is read (`rootSwitch`). */
function switchTable(
  plan: ImpostorPlan,
  roots: readonly ImpostorRoot[],
  section: ImpostorSection | undefined,
  focal: number,
) {
  let table = tables.get(plan)
  if (
    !table ||
    table.roots !== roots ||
    table.section !== section ||
    table.held.length !== roots.length
  ) {
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
    tables.set(plan, table)
  }
  table.focal = focal
  return table
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
 * Plans the impostor tier for one view: every root whose mesh has a baked entry and whose switch
 * holds yields a card and is marked suppressed. `view` maps world to view space (column-major) and
 * `focalPixels` is the engine's one focal length in pixels at the image's viewport. `into`, a plan
 * a previous view returned, is planned again in place: its `switched`, its cards and its roots'
 * switch numbers (`SwitchTable`) are reused, so a runtime planning every image allocates nothing
 * once its card count settles, and reads of each root only its pivot until it turns or scales.
 */
export function planImpostors(
  roots: readonly ImpostorRoot[],
  section: ImpostorSection | undefined,
  view: ArrayLike<number>,
  focalPixels: number,
  into?: ImpostorPlan,
  /** Hands each rank to read to `visit`, when only some can change what the image draws (the
   *  roots in view, a placement tree's, `gpu/dag/placementTree.ts`); a rank it does not read keeps
   *  its verdict — out of view, it draws nothing either way, and its card bit never moves by the
   *  view leaving it: each move would void the cut in hand. A rank read with `card` false takes
   *  none, whatever its distance (one another structure draws far away). Absent, every root,
   *  every image. */
  ranks?: (visit: (rank: number, card?: boolean) => void) => void,
): ImpostorPlan {
  const plan = into ?? { cards: [], switched: new Uint8Array(roots.length) }
  if (plan.switched.length !== roots.length) plan.switched = new Uint8Array(roots.length)
  const reading = {
    plan,
    roots,
    view,
    byMesh: bakedLookup(section),
    table: switchTable(plan, roots, section, focalPixels),
    count: 0,
  }
  if (ranks) {
    const visited: number[] = (plan.visited = [])
    ranks((rank, card) => {
      visited.push(rank)
      planRoot(reading, rank, card !== false)
    })
  } else {
    if (plan.visited) delete plan.visited
    for (let rank = 0; rank < roots.length; rank++) planRoot(reading, rank)
  }
  plan.cards.length = reading.count
  return plan
}

/** One root's verdict, and its card when it switches. */
function planRoot(
  reading: {
    plan: ImpostorPlan
    roots: readonly ImpostorRoot[]
    view: ArrayLike<number>
    byMesh: BakedLookup
    table: SwitchTable
    count: number
  },
  rank: number,
  carded = true,
) {
  const { plan, table } = reading,
    root = reading.roots[rank],
    entry = carded ? rootSwitch(table, rank, root, reading.byMesh) : undefined
  const world = root.world.elements
  if (entry) transformAffinePoint(point, reading.view, world[12], world[13], world[14])
  // Each rank read takes its verdict here, whatever it held: nothing is cleared ahead of the read.
  if (!entry || !switchesAt(table.texelDepth[rank], table.triangleDepth[rank], point)) {
    plan.switched[rank] = 0
    return
  }
  plan.switched[rank] = 1
  const card = (plan.cards[reading.count++] ??= {} as ImpostorCard)
  card.root = rank
  card.mesh = entry.mesh
  card.world = world
  card.centre ??= [0, 0, 0]
  card.centre[0] = world[12]
  card.centre[1] = world[13]
  card.centre[2] = world[14]
  card.radius = table.radius[rank]
  card.frames = entry.frames
  card.hemi = entry.hemi === true
  card.maps = entry.maps
}
