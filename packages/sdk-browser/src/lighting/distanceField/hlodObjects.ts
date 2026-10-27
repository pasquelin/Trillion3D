import type { MeshDistanceField } from '../../../../sdk-core/src/lighting/distanceFieldFile.ts'
import { MARK_BITS } from '../../visibility/shader/castingMark.ts'
import type { TrackedRoot } from './objectTracker.ts'

/**
 * THE HLOD CELLS' FIELDS AS PLACEMENTS. The compiler builds a distance field for the actors of an
 * HLOD cell where their layer allows one (`allowDistanceField`): the merged shell's own triangles,
 * in the space of the world DAG, which a compiled mesh's field never covers. The world DAG is one
 * root of the cut — or one for each placement of its model, an instance of it —, drawing every cell's
 * actor at once, so it places none of them as a mesh: a stand-in root is made for each field and each
 * instance. A stand-in is at its root's world, with its mark — the world DAG's: its shell casts
 * and the sun's far-shadow test reaches it (`objectTracker.ts`) —, and it is one of the roots the
 * tracker reads only while the cut draws the cell's actor (`WorldCells.draws`): an actor the view
 * does not draw — its cell shown instead, or not loaded — holds no placement and no room in the
 * atlas, and casts nothing through its field. The tracker reads the stand-ins after the cut's roots,
 * as it reads the roots themselves.
 */

/** What tells the stand-ins whether an actor draws: the cut's world cells. */
export interface HlodDraws {
  /** Whether the actor of HLOD cell `cell` of instance `instance` draws at the last cut. */
  draws(instance: number, cell: number): boolean
}

/** Whether `root` is a placement of the world DAG (the cut's root that carries the table of its cells, `hlod`): the
 *  one rule every reader of the cut's roots tells them by. */
export const isWorldRoot = (root: { readonly hlod?: unknown }) => Boolean(root.hlod)

/** A root of the world DAG among the cut's roots. */
interface WorldRoot {
  readonly root: TrackedRoot
  readonly rank: number
}

/** The stand-in for `world` that places `field` in instance `instance`. It is listed only while
 *  the cut draws its cell's actor (`createHlodObjects`), so it is hidden as its root is; every
 *  value is read from the root as it stands. */
function standIn(world: WorldRoot, instance: number, field: MeshDistanceField) {
  const { root, rank } = world
  return {
    field,
    instance,
    standsFor: rank,
    get world() {
      return root.world
    },
    get worldAt() {
      return root.worldAt
    },
    get parked() {
      return root.parked
    },
    get hidden() {
      return root.hidden
    },
    // A placement of the world DAG: its host root does not carry the world's own bit, which the
    // packing adds (`packRoots.ts`), and the far-shadow test reaches its shells by it.
    get mark() {
      return (root.mark ?? 0) | MARK_BITS.worldRoot
    },
    get drawDistance() {
      return root.drawDistance
    },
  } satisfies TrackedRoot
}

/** Whether root `rank` of a list is often moving, for the list `joined` that `join` made of `roots`:
 *  a stand-in moves as the root it stands for, a root of the cut as `moving` says. */
export const movingOf = (
  roots: readonly TrackedRoot[],
  joined: readonly TrackedRoot[],
  moving: (rank: number) => boolean,
) => (joined === roots ? moving : (rank: number) => moving(joined[rank].standsFor ?? rank))

/**
 * The stand-ins for the cells whose fields are `fields` (those flagged `hlodCell`; the others are
 * left alone). `join` returns the cut's roots as they are when there is nothing to place, else a
 * list of them with, after them, the stand-ins of the actors the cut draws now: the world DAG's
 * roots in order are its instances. The list is made again only when the cut's roots, its world
 * cells or the actors it draws change, and then it is another list.
 */
export function createHlodObjects(fields: readonly MeshDistanceField[]) {
  const cells = fields.filter((field) => field.hlodCell)
  let joined: readonly TrackedRoot[] = []
  let source: readonly TrackedRoot[] | undefined
  let length = -1
  let cut: HlodDraws | undefined
  let worlds: WorldRoot[] = []
  /** Every stand-in of the world DAG's roots, and whether each is drawn as `joined` holds them. */
  let standIns: ReturnType<typeof standIn>[] = []
  let placed = new Uint8Array(0)
  /** Whether the stand-ins still stand for `roots`: the same list, as long, its world roots the
   *  same, the same world cells. */
  const standing = (roots: readonly TrackedRoot[], world: HlodDraws) =>
    roots === source &&
    roots.length === length &&
    world === cut &&
    worlds.every(({ root, rank }) => roots[rank] === root)
  return {
    /** How many HLOD cells have a field. */
    count: cells.length,
    join(roots: readonly TrackedRoot[], world: HlodDraws | undefined): readonly TrackedRoot[] {
      if (!cells.length || !world) return roots
      let changed = !standing(roots, world)
      if (changed) {
        source = roots
        length = roots.length
        cut = world
        worlds = []
        roots.forEach((root, rank) => {
          if (isWorldRoot(root)) worlds.push({ root, rank })
        })
        standIns = worlds.flatMap((at, instance) =>
          cells.map((field) => standIn(at, instance, field)),
        )
        placed = new Uint8Array(standIns.length)
      }
      for (let at = 0; at < standIns.length; at++) {
        const drawn = world.draws(standIns[at].instance, standIns[at].field.mesh) ? 1 : 0
        if (placed[at] === drawn) continue
        placed[at] = drawn
        changed = true
      }
      if (!changed) return joined
      const drawn = standIns.filter((_, at) => placed[at])
      return (joined = drawn.length ? [...roots, ...drawn] : roots)
    },
  }
}
