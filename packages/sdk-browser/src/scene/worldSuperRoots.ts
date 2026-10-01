/**
 * THE WORLD SUPER-ROOTS AS THE ONE CUT READS THEM (#1238).
 *
 * The cook continues the DAG above every object's roots, per cell and material, up to one world top
 * (`world-roots.json`, docs/FORMAT.md, World super-roots; #23, #1237). This module turns that world
 * DAG into the engine's own shape — one `DagRoot` with a single `ClusterStructureIndex` and one
 * culling hierarchy — so the existing cut (`page/cut/rule.ts`, the selection shader `gpu/dag/shader/shader.ts`) draws a
 * far cell's super-roots in place of its per-instance roots when those are not resident, and draws
 * them again only once: the group relation between a cell's object roots (children) and its
 * super-roots (outputs) is the same "parent stands in for its children" term the cut already runs
 * inside a primitive, so there is no second selection path and no second BVH (rule 7).
 *
 * The world pages are world-space geometry (`worldRootsPage`): the root's world matrix is the
 * identity, and the pages' `min`/`max`/`sphere` are their own world-space bounds. As cluster's
 * hierarchy is, the DAG is read in the cook's own cluster order, never re-sorted: a cluster out of
 * its rank is refused, `WORLD_CLUSTER_RANK`, since the groups name clusters by rank.
 */

import type { DagRoot } from '../gpu/dag/types.ts';
import type { ClusterGroup } from '../../../sdk-core/src/index.ts';
import type { WorldRootsCluster } from '../../../sdk-core/src/manifest/worldRoots.ts';
import { structureIndex } from '../page/selection/structure.ts';
import { flatHierarchy } from '../gpu/dag/hierarchy.ts';
import { IDENTITY_ELEMENTS } from '../math/matrixElements.ts';
import { worldRootsPageAddress } from './worldRootsPage.ts';

/** The `clusters` and `groups` of a world-roots table, added by the cook without a version bump.
 *  A group's `children` and `outputs` name clusters by rank (`dag/levels.rs`, `merge.rs`). */
export type WorldRootsDagTable = {
  clusters?: readonly WorldRootsCluster[];
  groups?: ClusterGroup[];
  payload?: { url: string };
};

/**
 * The world `DagRoot` of a world-roots table (world-space, identity matrix): its clusters in their
 * cook rank, a `ClusterStructureIndex` from its groups, and a flat culling hierarchy over them. A
 * super-root's page is named by `payload.url` and its `bundle`/`offset`; an object root's is left
 * to its own stream (the cut reads its residency through the structure, its page through the
 * placement). The world top — the clusters nothing replaces — are the structure's roots, as a
 * primitive's root cover is, so the pinned top is the cut's fallback and the cell super-roots are
 * its middle levels.
 */
export function worldRootDag(table: WorldRootsDagTable): DagRoot | undefined {
  const { clusters, groups } = table;
  if (!clusters?.length || !groups?.length) return undefined;
  const url = table.payload?.url ?? '';
  const pages = clusters.map((cluster, rank) => {
    if (cluster.cluster !== rank)
      throw new Error(`WORLD_CLUSTER_RANK: ${cluster.cluster} at ${rank}`);
    const {
      bundle,
      offset,
      level,
      lodError,
      sphere,
      parentError,
      parentSphere,
      min,
      max,
      triangles,
    } = cluster;
    return {
      url: bundle === null || offset === null ? '' : worldRootsPageAddress(url, bundle, offset),
      level,
      lodError,
      sphere,
      parentError,
      parentSphere,
      min,
      max,
      triangles,
    };
  });
  const roots = clusters.flatMap((cluster, rank) => (cluster.parentError === null ? [rank] : []));
  const structure = structureIndex({ version: 1, roots, groups }, pages.length);
  return {
    world: { elements: IDENTITY_ELEMENTS },
    pages,
    structure,
    // Its links are the cut's own, derived once per hierarchy (`linksFor`, `page/cut/links.ts`).
    culling: flatHierarchy(pages),
  };
}
