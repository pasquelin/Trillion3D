/**
 * The per-instance draw state of the WebGL2 autonomous backend, keyed by packed index (#1234):
 * what a placement's copy of a page owns — its geometry, its host mesh, whether it is attached to
 * the scene, the surface it wears and the last material-class change it followed. A `PageRec`
 * carries none of it, so one record per primitive can serve every placement (#1235). The layout
 * posts one draw per (placement, page), carried from one layout to the next by the ROOT it belongs
 * to; the catalogue resolves a packed rank back to its record, and `placement` to its root.
 */
import { createPageCatalogue, type PageCatalogue } from '../../page/selection/catalogue.ts';
import { postPackedBases, type PlacementIndex } from '../../page/selection/placements.ts';
import type { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts';
import type { HostMaterials, HostMesh } from '../../host/resources.ts';
import type { ClusterRoot, PageRec } from '../../page/selection/types.ts';

export type PageDraw = {
  /** The record this state belongs to: an accessor checks it, as the catalogue does. */
  readonly page: PageRec;
  geometry?: Geometry;
  mesh?: HostMesh;
  attached: boolean;
  material?: HostMaterials;
  /** The last material-class change this instance followed (`classPages.ts`). */
  turn: number;
};

export type PageDraws = ReturnType<typeof createPageDraws>;

const blank = (page: PageRec): PageDraw => ({ page, attached: false, turn: 0 });

export function createPageDraws(roots: readonly ClusterRoot<PageRec>[] = []) {
  let pages: PageRec[] = [],
    draws: PageDraw[] = [],
    catalogue: PageCatalogue = createPageCatalogue(pages),
    placement: PlacementIndex = postPackedBases(roots);
  /** The first packed rank of each record: a per-PAGE lookup, never a per-instance one. */
  let first = new Map<PageRec, number>();
  /** The draws of each root, by record, carried from one layout to the next: a row's state is its
   *  own, and a layout that inserts or moves a page keeps the others' (#1234). */
  let owned = new Map<ClusterRoot<PageRec>, Map<PageRec, PageDraw>>();
  /** A record that had a single instance, and how many it had: a re-layout that recreates the root
   *  object — a synthetic layout — carries its draw from here (#1235). */
  let single = new Map<PageRec, PageDraw>(),
    instances = new Map<PageRec, number>();

  /** Lays `roots` out: one packed rank per (placement, page), the catalogue over the packed order,
   *  and each instance's draw state carried from the root it belonged to; a new instance is blank. */
  function layOut(next: readonly ClusterRoot<PageRec>[]) {
    const nextPages: PageRec[] = [],
      nextDraws: PageDraw[] = [],
      nextFirst = new Map<PageRec, number>(),
      nextOwned = new Map<ClusterRoot<PageRec>, Map<PageRec, PageDraw>>();
    // Pass 1: the draw a root it is already known by carries, by record.
    const carried: (PageDraw | undefined)[][] = [],
      assigned = new Set<PageRec>();
    for (const root of next) {
      const before = owned.get(root),
        row: (PageDraw | undefined)[] = [];
      for (const rec of root.pages) {
        const draw = before?.get(rec);
        if (draw) assigned.add(rec);
        row.push(draw);
      }
      carried.push(row);
    }
    // Pass 2: a root without one reclaims a single-instance record's draw, never one already taken.
    for (let r = 0; r < next.length; r++) {
      const root = next[r],
        byRecord = new Map<PageRec, PageDraw>();
      for (let p = 0; p < root.pages.length; p++) {
        const rec = root.pages[p];
        let draw = carried[r][p];
        if (!draw && (instances.get(rec) ?? 0) === 1 && !assigned.has(rec)) {
          draw = single.get(rec);
          assigned.add(rec);
        }
        if (!draw || draw.page !== rec) draw = blank(rec);
        byRecord.set(rec, draw);
        if (!nextFirst.has(rec)) nextFirst.set(rec, nextPages.length);
        nextPages.push(rec);
        nextDraws.push(draw);
      }
      nextOwned.set(root, byRecord);
    }
    pages = nextPages;
    draws = nextDraws;
    first = nextFirst;
    owned = nextOwned;
    single = new Map();
    instances = new Map();
    for (const draw of nextDraws) {
      instances.set(draw.page, (instances.get(draw.page) ?? 0) + 1);
      if (!single.has(draw.page)) single.set(draw.page, draw);
    }
    placement = postPackedBases(next);
    catalogue = createPageCatalogue(pages);
  }
  layOut(roots);

  /** The state of packed rank `packed`, which must be laid out: every writer goes through this. */
  const at = (packed: number): PageDraw | undefined => draws[packed];
  /** The FIRST instance of `rec`: a per-page reader uses this; a per-instance one uses `at`. */
  const find = (rec: PageRec): PageDraw | undefined => {
    const packed = first.get(rec);
    return packed === undefined ? undefined : draws[packed];
  };
  /** The state of `rec`'s first instance, which must be laid out. */
  const drawing = (rec: PageRec): PageDraw => {
    const draw = find(rec);
    if (!draw) throw new Error('PAGE_DRAW_MISSING');
    return draw;
  };
  return {
    get pages(): readonly PageRec[] {
      return pages;
    },
    /** The packed rank of `rec`'s first instance, or -1: a per-page lookup, not per-instance. */
    firstPacked: (rec: PageRec) => first.get(rec) ?? -1,
    /** The root rank of `rec`'s first instance, or -1: a per-page lookup, for a per-page property. */
    rootRankOf: (rec: PageRec) => {
      const packed = first.get(rec);
      return packed === undefined ? -1 : (placement.rootOfPacked[packed] ?? -1);
    },
    /** The per-placement tables, rebuilt at each layout (#1235). */
    get placement(): PlacementIndex {
      return placement;
    },
    layOut,
    at,
    find,
    drawing,
    geometryOf: (rec: PageRec) => find(rec)?.geometry,
    materialOf: (rec: PageRec) => find(rec)?.material,
    /** What a consumer resolves the cut's packed ranks through (`recordOf`). */
    recordOf: (packed: number) => catalogue.recordOf(packed),
    /** Runs `visit` on the packed rank of every instance of `rec`: a shared page's roots all hear
     *  of a change to the page's bytes or array. Not hot: called on a coverage flip. */
    forEachRank(rec: PageRec, visit: (packed: number) => void) {
      for (let packed = 0; packed < pages.length; packed++)
        if (pages[packed] === rec) visit(packed);
    },
    /** Gives back what every instance of `rec` that left the scene owned, before its state drops. */
    forget(rec: PageRec) {
      for (const draw of draws)
        if (draw.page === rec) {
          draw.geometry = draw.mesh = undefined;
          draw.material = undefined;
          draw.attached = false;
        }
    },
  };
}
