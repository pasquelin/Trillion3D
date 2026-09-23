/**
 * GROWING AN INSTANCE BUFFER IN PLACE — the one contract every engine follows.
 *
 * A session holds each resource's instance buffer at a capacity. When its owner needs more rows,
 * it does not open the session again: it replaces the buffer `from` by a larger one `to` whose
 * first rows are `from`'s, the rows past them parked, and hands both to the engine
 * (`BackendSceneUpdates.growPlacements`). The engine then
 *   1. rebinds every root, page and copy that read a row of `from` onto the same row of `to`;
 *   2. appends one root per new row, cloned from a root of the same buffer: its pages name the
 *      same clusters, geometry and surface, only the world and the per-placement marks are its own;
 *   3. grows its own tables where the new roots overflow them — geometrically, like the owner's
 *      buffer, so a scene that grows by one placement at a time grows each table a logarithmic
 *      number of times.
 * The rows then follow through `updatePlacements`, as any row does. Nothing is prepared again.
 */
import { BOX_VALUES } from '../../../sdk-core/src/index.ts';
import type { PageRec, ClusterRoot } from '../page/selection/types.ts';
import { forgetRowRoots } from './placementUpdate.ts';
import { placementWorld, type PlacementOf, type PlacementRows } from './placementRows.ts';

/** A root's pages and itself posed by `placement`, whose world is a view on its row. */
function pose(root: ClusterRoot<PageRec>, placement: PlacementOf) {
  const world = placementWorld(placement.rows, placement.index);
  root.world = world;
  root.placement = placement;
  for (const page of root.pages) {
    page.matrix = world;
    page.placement = placement;
  }
}

/** A parked root for row `index` of `rows`, cloned from `template`: shared clusters and tables,
 *  its own world, box, marks and forced groups; its local box is the template's. Its box is set when its row is taken. */
function rowRoot(template: ClusterRoot<PageRec>, rows: PlacementRows, index: number) {
  const culling = template.culling;
  const root: ClusterRoot<PageRec> = {
    ...template,
    pages: template.pages.map((page) => ({ ...page, mesh: undefined, attached: false })),
    culling: culling && {
      ...culling,
      marks: culling.marks && new Int32Array(culling.marks.length),
    },
    worldBox: template.worldBox && new Float64Array(BOX_VALUES),
    stretch: undefined,
    stretchKey: undefined,
    forced: template.forced && new Uint8Array(template.forced.length),
    forcedList: template.forcedList && [],
    parked: true,
  };
  pose(root, { rows, index });
  return root;
}

/**
 * Steps 1 and 2 of the contract on any list posed by rows: each item of `from` is `rebind`-ed to
 * the same row of `to`, and one item per new row is `clone`-d from the first of them, returned
 * with it. `items` itself is not extended.
 */
export function growPlaced<T extends { readonly placement?: PlacementOf }>(
  items: readonly T[],
  from: PlacementRows,
  to: PlacementRows,
  rebind: (item: T, placement: PlacementOf) => void,
  clone: (template: T, placement: PlacementOf) => T,
) {
  let template: T | undefined;
  for (const item of items)
    if (item.placement?.rows === from) {
      rebind(item, { rows: to, index: item.placement.index });
      template ??= item;
    }
  const added: { item: T; template: T }[] = [];
  if (template)
    for (let index = from.capacity; index < to.capacity; index++)
      added.push({ item: clone(template, { rows: to, index }), template });
  return added;
}

/** `growPlaced` on a root list: the roots of `from` read `to`, and one parked root per new row is
 *  returned — with the root whose pages its own pages copy rank for rank — for the engine to
 *  append to its tables. */
export function growRowRoots(
  roots: ClusterRoot<PageRec>[],
  from: PlacementRows,
  to: PlacementRows,
) {
  const added = growPlaced(roots, from, to, pose, (template, { rows, index }) =>
    rowRoot(template, rows, index),
  );
  forgetRowRoots(roots);
  return added;
}
