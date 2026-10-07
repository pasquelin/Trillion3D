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
 *  A group's `children` and `outputs` name clusters by rank (`dag/levels.rs`, `merge.rs`). */
export type WorldRootsDagTable = {
  clusters?: readonly WorldRootsCluster[]
  groups?: ClusterGroup[]
  payload?: { url: string }
}

/**
 * The world `DagRoot` of a world-roots table (world-space, identity matrix): its clusters in their
 * cook rank, a `ClusterStructureIndex` from its groups, and a flat culling hierarchy over them. A
 * super-root's page is named by `payload.url` and its `bundle`/`offset`; an object root's is left
 * to its own stream (the cut reads its residency through the structure, its page through the
 * placement). The world top — the clusters nothing replaces — are the structure's roots, as a
 * primitive's root cover is, so the pinned top is the cut's fallback and the cell super-roots are
 * its middle levels. `origins` names, per rank, the placed object an object root mirrors.
 */
export function worldRootDag(
  table: WorldRootsDagTable,
  pagesOf: typeof worldRootPages,
): (DagRoot & { origins: Int32Array }) | undefined {
  const { clusters, groups } = table
  if (!clusters?.length || !groups?.length) return undefined
  const { roots, pages, origins } = pagesOf(clusters, table.payload?.url || WORLD_ROOTS_BIN)
  const structure = structureIndex({ version: 1, roots, groups }, pages.length)
  return {
    world: IDENTITY_WORLD,
    pages,
    structure,
    // Its links are the cut's own, derived once per hierarchy (`linksFor`, `page/cut/links.ts`).
    culling: flatHierarchy(pages),
    // Each object root's placed object, which its residency mirrors (`gpu/dag/worldMirror.ts`).
    origins,
  }
}
