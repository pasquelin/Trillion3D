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
import type { ImpostorMap, ImpostorSection } from '../contracts/impostor.ts'
import { bakedLookup, point, readRoot, switchesAt, switchTable } from './switchTable.ts'

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
  /** Root ranks the cut suppresses: 1 at a switched root, 0 elsewhere. */
  switched: Uint8Array
}

export { impostorBakedByMesh } from './switchTable.ts'

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
  for (let rank = 0; rank < roots.length; rank++) planRoot(reading, rank)
  plan.cards.length = reading.count
  return plan
}

/** One root's verdict, and its card when it switches. */
function planRoot(
  reading: {
    plan: ImpostorPlan
    roots: readonly ImpostorRoot[]
    view: ArrayLike<number>
    byMesh: ReturnType<typeof bakedLookup>
    table: ReturnType<typeof switchTable>
    count: number
  },
  rank: number,
) {
  const { plan, table } = reading,
    root = reading.roots[rank],
    entry = readRoot(table, rank, root, reading.byMesh, reading.view)
  // Each rank read takes its verdict here, whatever it held: nothing is cleared ahead of the read.
  if (!entry || !switchesAt(table.texelDepth[rank], table.triangleDepth[rank], point)) {
    plan.switched[rank] = 0
    return
  }
  plan.switched[rank] = 1
  const world = root.world.elements
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
