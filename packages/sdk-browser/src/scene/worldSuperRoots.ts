/**
 * THE WORLD SUPER-ROOTS AS THE ONE CUT READS THEM.
 *
 * The cook continues the DAG above every object's roots, per cell and material, up to one world top
 * (`world-roots.dag`, docs/FORMAT.md, World super-roots). This module turns that world
 * DAG into the engine's own shape — one `DagRoot` with a single `ClusterStructureIndex` and one
 * culling hierarchy — so the existing cut (`page/cut/rule.ts`, the selection shader `gpu/dag/shader/shader.ts`) draws a
 * far cell's super-roots in place of its per-instance roots when those are not resident, and draws
 * them again only once: the group relation between a cell's object roots (children) and its
 * super-roots (outputs) is the same "parent stands in for its children" term the cut already runs
 * inside a primitive, so there is no second selection path and no second BVH (rule 7).
 *
 * The world pages are world-space geometry (`worldRootsPage`): the root's world matrix is the
 * identity, and the pages' `min`/`max`/`sphere` are their own world-space bounds. The
 * DAG is read in the cook's own cluster order, never re-sorted: a cluster out of
 * its rank is refused, `WORLD_CLUSTER_RANK`, since the groups name clusters by rank.
 */

import type { DagRoot } from '../gpu/dag/types.ts'
import type { ClusterGroup } from '../../../sdk-core/src/index.ts'
import {
  WORLD_ROOTS_BIN,
  type WorldRootsCluster,
} from '../../../sdk-core/src/manifest/worldRoots.ts'
import { structureIndex } from '../page/selection/structure.ts'
import { flatHierarchy } from '../gpu/dag/hierarchy.ts'
import { IDENTITY_WORLD } from '../host/matrixElements.ts'
import type { worldRootPages } from './worldPageServe.ts'

/** The `clusters` and `groups` of a world-roots table, added by the cook without a version bump.
 *  A group's `children` and `outputs` name clusters by rank (`dag/levels.rs`, `merge.rs`).
 *  `pinned` counts the bundles of the pinned top (`WorldRoots.pinned`). */
export type WorldRootsDagTable = {
  clusters?: readonly WorldRootsCluster[]
  groups?: ClusterGroup[]
  payload?: { url: string }
  pinned: number
}

/** The world clusters as `worldRootPages` names them: what the cut projects, the primitive each
 *  wears, its page and that page's facts. */
type WorldPages = ReturnType<typeof worldRootPages>['pages']

/** The world DAG as the one cut reads it: a `DagRoot` over its pages, the placed object of each
 *  object root, and the roots each bundle past the pinned top holds for its cell. */
export type WorldDagRoot = Omit<DagRoot, 'pages'> & {
  pages: WorldPages
  origins: Int32Array
  held: ReadonlyMap<number, readonly number[]>
}

/**
 * The world `DagRoot` of a world-roots table (world-space, identity matrix): its clusters in their
 * cook rank, a `ClusterStructureIndex` from its groups, and a flat culling hierarchy over them. A
 * super-root's page is named by `payload.url` and its `bundle`/`offset`; an object root's is left
 * to its own stream (the cut reads its residency through the structure, its page through the
 * placement). The clusters nothing replaces are the structure's roots; those of the pinned bundles,
 * the world top, are the cut's fallback as a primitive's root cover is, and the cell super-roots
 * its middle levels; a root one cell alone needs is `held` by its cell's bundle, its `holder`,
 * resident while that cell is held (`../../../asset-compiler-rust/src/compiler_world_roots/top.rs`). `origins` names, per rank, the placed object an object
 * root mirrors.
 */
export function worldRootDag(
  table: WorldRootsDagTable,
  pagesOf: typeof worldRootPages,
): WorldDagRoot | undefined {
  const { clusters, groups } = table
  if (!clusters?.length || !groups?.length) return undefined
  const url = table.payload?.url || WORLD_ROOTS_BIN
  const { roots, held, pages, origins, slack } = pagesOf(clusters, url, table.pinned)
  const structure = structureIndex({ version: 1, roots, groups }, pages.length, slack)
  return {
    world: IDENTITY_WORLD,
    pages,
    structure,
    // Its links are the cut's own, derived once per hierarchy (`linksFor`, `page/cut/links.ts`).
    culling: flatHierarchy(pages),
    // Each object root's placed object, which its residency mirrors (`gpu/dag/worldMirror.ts`).
    origins,
    held,
  }
}
