/**
 * THE WORLD SUPER-ROOTS AS THE ONE CUT READS THEM (#1238).
 *
 * The cook continues the DAG above every object's roots, per cell and material, up to one world top
 * (`world-roots.json`, docs/FORMAT.md, World super-roots; #23, #1237). This module turns that world
 * DAG into the engine's own shape — one `DagRoot` with a single `ClusterStructureIndex` and one
 * culling hierarchy — so the existing cut (`page/cut/rule.ts`, `gpu/dag/oracle/oracle.ts`) draws a
 * far cell's super-roots in place of its per-instance roots when those are not resident, and draws
 * them again only once: the group relation between a cell's object roots (children) and its
 * super-roots (outputs) is the same "parent stands in for its children" term the cut already runs
 * inside a primitive, so there is no second selection path and no second BVH (rule 7).
 *
 * The world pages are world-space geometry (`worldRootsPage`): the root's world matrix is the
 * identity, and the pages' `min`/`max`/`sphere` are their own world-space bounds.
 */

import type { DagRoot } from '../gpu/dag/types.ts';
import { structureIndex } from '../page/selection/structure.ts';
import { flatHierarchy } from '../gpu/dag/hierarchy.ts';
import { cullingLinks } from '../page/cut/links.ts';
import { IDENTITY_ELEMENTS } from '../math/matrixElements.ts';
import { worldRootsPageAddress } from './worldRootsPage.ts';

/** One world cluster — an object root or a super-root — with the fields the cut projects, named by
 *  its rank in the cook's world DAG (`cluster`), which the group relation uses. */
type WorldSuperRootCluster = {
  cluster: number;
  url: string;
  level: number;
  lodError: number;
  sphere: number[];
  parentError: number | null;
  parentSphere: number[] | null;
  min: number[];
  max: number[];
  triangles: number;
};

/** One group of the world DAG: the fine `children` its coarse `outputs` replace, its error and its
 *  sphere (`dag/levels.rs`, `merge.rs`). `children` and `outputs` name clusters by `cluster`. */
type WorldSuperRootGroup = {
  level: number;
  error: number;
  sphere: number[];
  children: number[];
  outputs: number[];
};

/** One cluster as the cook's `clusters` key publishes it (`worldRoots.json`, FORMAT.md): the
 *  fields above, plus where its page lives — a super-root's `bundle` and `offset` in the binary, an
 *  object root's `origin` (the placed instance whose own stream holds its page). Read with an
 *  internal type so the exported `WorldRoots` stays what the API reference translates. */
type WorldRootsCookedCluster = Omit<WorldSuperRootCluster, 'url'> & {
  material: number | null;
  bundle: number | null;
  offset: number | null;
  origin: number | null;
};

/** The `clusters` and `groups` of a world-roots table, added by the cook without a version bump. */
export type WorldRootsDagTable = {
  clusters?: readonly WorldRootsCookedCluster[];
  groups?: readonly WorldSuperRootGroup[];
  payload?: { url: string };
};

/**
 * The world DAG as one `DagRoot` (world-space, identity matrix): its clusters ordered by their
 * cook rank, a `ClusterStructureIndex` from its groups, and a flat culling hierarchy over them.
 * The world top — the clusters nothing replaces — are the structure's roots, as a primitive's root
 * cover is, so the pinned top is the cut's fallback and the cell super-roots are its middle levels.
 */
function buildWorldSuperRootRoot(
  clusters: readonly WorldSuperRootCluster[],
  groups: readonly WorldSuperRootGroup[],
): DagRoot {
  const ordered = clusters
    .map((cluster) => ({ cluster }))
    .sort((a, b) => a.cluster.cluster - b.cluster.cluster);
  const flatOf = new Map<number, number>();
  ordered.forEach(({ cluster }, flat) => flatOf.set(cluster.cluster, flat));
  const pages = ordered.map(({ cluster }) => ({
    url: cluster.url,
    level: cluster.level,
    lodError: cluster.lodError,
    sphere: cluster.sphere,
    parentError: cluster.parentError,
    parentSphere: cluster.parentSphere,
    min: cluster.min,
    max: cluster.max,
    triangles: cluster.triangles,
  })) as DagRoot['pages'];
  const roots = ordered
    .map(({ cluster }, flat) => (cluster.parentError === null ? flat : -1))
    .filter((flat) => flat >= 0);
  const structure = structureIndex(
    {
      version: 1,
      roots,
      groups: groups.map((group) => ({
        level: group.level,
        error: group.error,
        sphere: group.sphere,
        children: group.children.map((cluster) => flatOf.get(cluster)!),
        outputs: group.outputs.map((cluster) => flatOf.get(cluster)!),
      })),
    } as never,
    pages.length,
  );
  const culling = flatHierarchy(pages);
  return {
    world: { elements: IDENTITY_ELEMENTS },
    pages,
    structure,
    culling: { ...culling, links: cullingLinks(culling, pages.length) },
  };
}

/** The world `DagRoot` of a world-roots table, its pages named where the cook wrote them: a
 *  super-root by `payload.url` and its `bundle`/`offset`, an object root left to its own stream
 *  (the cut reads its residency through the structure, its page through the placement). */
export function worldRootDag(table: WorldRootsDagTable): DagRoot | undefined {
  const clusters = table.clusters,
    groups = table.groups;
  if (!clusters?.length || !groups?.length) return undefined;
  const url = table.payload?.url ?? '';
  return buildWorldSuperRootRoot(
    clusters.map(({ bundle, offset, ...cluster }) => ({
      ...cluster,
      url: bundle === null || offset === null ? '' : worldRootsPageAddress(url, bundle, offset),
    })),
    groups,
  );
}
