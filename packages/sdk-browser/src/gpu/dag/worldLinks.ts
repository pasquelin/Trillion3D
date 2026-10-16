/**
 * A PLACEMENT AND THE WORLD CLUSTER THAT STANDS IN FOR IT.
 *
 * The cook continues every placed object into its cell's super-roots, then into the regions above
 * them, up to the world top (`world-roots.dag`): one DAG of the world, whose level 0 is the placed
 * objects, each one cluster (`compiler_world_roots/place.rs`), each with a world parent. Packed in
 * the one cut as its last root (`scene/worldSuperRoots.ts`), it is the far field: a cell's
 * super-roots are the middle ring, the levels that group several cells the far ring, all chosen by
 * the one rule at the one threshold, cluster by cluster, never by a distance. A terrain cooked tile
 * by tile is placed objects like any other: each tile its own DAG near, its cell's super-roots
 * past, the regions far — continuous, and no second mechanism beside the cut.
 *
 * A placement whose object the world DAG holds (an `origin`, `GpuSelection.placeObject`) is linked
 * here to that object's world cluster, one word per placement behind the cold records. Before the descent
 * prepares a placement it asks whether the world draws it instead (`worldCovers`,
 * `shader/placementTreeWgsl.ts`): its object's world group is not ready — an object of the group
 * is not placed or its cover not resident, so the group's super-roots stand in — while every root
 * of the world above the object is, or the group's error projects within the threshold — the very
 * comparison the group's super-roots draw on, the same operands in the same frame
 * (`drawsCluster`). The placement draws only where the super-roots do not: never both, never
 * neither. A covered placement is neither prepared nor descended.
 *
 * The roots above an object are the pinned top, or roots its cell's hold asks for
 * (`../../webgpu/residency/sets.ts`, `holdCover`) — a lone object's copies, a cell's super-root no
 * top continued — which arrive after the placement may: until every one is ready, the world's
 * stand-in has a hole, and the placement draws itself. A group's root outputs are ready together
 * (`../../page/cut/readiness.ts`): the world never draws a part of them beside the placement.
 * Each object cluster leads to one flag its roots raise together (`worldStandIns.ts`), read only
 * for an object whose group is not ready.
 *
 * Its transitions are dithered in time: each cut holds the world DAG to a threshold scaled within
 * one octave below the frame's (`worldFade.ts`), its links with it, and the temporal antialiasing
 * averages the cuts into a cross-fade, never coarser than the frame's threshold.
 *
 * What each ring costs a frame, in visible quantities (`t` a node test, `p` a placement's prepare,
 * `g` the link's one record read and projection, `q` a page test):
 *  - near ring, objects at their own detail: `S·t + V_open·(g + p + D·t) + R_near·q`, `S` the
 *    cells and groups of the placement tree the frustum keeps, `V_open` the placements in kept
 *    groups whose world group projects past the threshold, `D` their hierarchy depth, `R_near`
 *    the pages of their kept leaves;
 *  - middle and far rings, super-roots: `V_covered·g + K_w·t + R_w·q`, `V_covered` the placed
 *    objects the world stands in for, `K_w` the world DAG's nodes the frustum and the error keep,
 *    `R_w` the super-roots of its kept leaves — at one pixel of error each, bounded by the screen,
 *    not by the world; a far cell places no object (`partition/farCells.ts`), so `V_covered` is
 *    bounded by the placed cells.
 * No term follows the placements rather than the view: a moving eye costs the CPU nothing, and each
 * thread that reads a placement takes the eye off its exact translation once — one double
 * subtraction an axis, 24 B read (`shader/worldPoseWgsl.ts`, `shader/primitiveWgsl.ts`) —, never a
 * pass over the `N` placements.
 */
import type { DagCutLinks, DagRoot } from './types.ts'
import type { StandInSets, standInWords } from './worldStandIns.ts'
import { NO_INDEX } from '../../../../math/src/constants.ts'

/** The world DAG's placement, its `origins`, and per placement the world cluster that stands in for
 *  it (`NO_INDEX` without), held at `linkBase` in the cold table behind the world DAG's record shift
 *  and its stand-ins' (`worldStandIns`); the placements whose link moved are handed to the residency
 *  mirror (`linksMoved`). */
export type PackedWorld = {
  root: number
  origins: Int32Array
  /** The world cluster of each object, by its `origin`, -1 for none: one cluster per object. */
  clusterOf: Int32Array
  /** The link a placement of `object` takes: its world cluster's packed page, `NO_INDEX` for none. */
  linkOf: (object: number) => number
  links: Uint32Array
  linkBase: number
  /** The sets of roots above the objects, and the cold word of their first flag
   *  (`worldStandIns.ts`). */
  standIns: StandInSets
  flagBase: number
  /** Told the placements whose link moved, increasing — the one list the cut's upload writes them
   *  from (`worldFollow.ts`) —: the residency mirror reads them at its next update. */
  linksMoved?: (placements: Int32Array, count: number) => void
  /** The scale of the world DAG's threshold this cut, its transitions dithered in time
   *  (`worldFade.ts`); 1, none. */
  scale: number
}

/** The world cluster of each object, by its `origin`: one cluster per placed object. */
function objectClusters(origins: Int32Array) {
  let objects = 0
  for (const origin of origins) objects = Math.max(objects, origin + 1)
  const rank = new Int32Array(objects).fill(-1)
  origins.forEach((origin, at) => origin >= 0 && (rank[origin] = at))
  return rank
}

/** Words before the links: the stand-ins' shift, then the world DAG's record shift. */
const LINK_HEADER = 2

/** The words the links take behind the cold records: the header, one per placement, then the
 *  stand-ins' (`worldStandIns.ts`). */
export const worldLinkWords = (worldCount: number, standIns: Uint32Array) =>
  LINK_HEADER + worldCount + standIns.length

/**
 * The world DAG of `roots`, packed at `world` with `cutLinks` and its record `shift`, written into
 * the cold table `cold` from `at`: the header, one link per placement slot of the packing —
 * `slots`, those a growth appends included (`linkBase`) —, none until a placement says which
 * object it places (`GpuSelection.placeObject`, `worldFollow.ts`), then the stand-ins' words
 * (`worldStandIns.ts`, `standInWords`), whose shift from a world cluster's packed page the header
 * leads with.
 */
export function packWorldLinks(
  roots: readonly DagRoot[],
  [world, shift]: [number, number],
  [slots, { words, standIns }]: [number, ReturnType<typeof standInWords>],
  { cutLinks, cold, at }: { cutLinks: readonly DagCutLinks[]; cold: Uint32Array; at: number },
): PackedWorld {
  const linkBase = at + LINK_HEADER
  const origins = roots[world].origins!,
    clusterOf = objectClusters(origins),
    base = cutLinks[world].pageBase
  const links = new Uint32Array(Math.max(slots, roots.length)).fill(NO_INDEX)
  const standInBase = linkBase + links.length
  cold[at] = (standInBase - base) >>> 0
  cold[at + 1] = shift
  cold.set(links, linkBase)
  cold.set(words, standInBase)
  const linkOf = (object: number) => {
    const rank = object >= 0 ? (clusterOf[object] ?? -1) : -1
    return rank >= 0 ? base + rank : NO_INDEX
  }
  const flagBase = standInBase + cutLinks[world].pageCount
  return { root: world, origins, clusterOf, linkOf, links, linkBase, standIns, flagBase, scale: 1 }
}
