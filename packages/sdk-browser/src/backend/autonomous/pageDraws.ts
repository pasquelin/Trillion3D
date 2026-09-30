/**
 * The per-instance draw state of the WebGL2 autonomous backend, keyed by packed index (#1234):
 * what a placement's copy of a page owns — its geometry, its host mesh, whether it is attached to
 * the scene, the surface it wears and the last material-class change it followed. A `PageRec`
 * carries none of it, so one record per primitive can serve every placement (#1235). The arrays
 * are fed by `packedIndex`, as the WebGPU row state is (`webgpu/row/state.ts`); the catalogue
 * (`page/selection/catalogue.ts`) resolves a packed rank back to its record.
 */
import { createPageCatalogue, type PageCatalogue } from '../../page/selection/catalogue.ts';
import type { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts';
import type { HostMaterials, HostMesh } from '../../host/resources.ts';
import type { ClusterRoot, PageRec } from '../../page/selection/types.ts';

export type PageDraw = {
  /** The record this state belongs to: an accessor checks it, as `catalogueIndexOf` does. */
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
    catalogue: PageCatalogue = createPageCatalogue(pages);

  /** Lays `roots` out: every page's placement rank and packed rank, the catalogue over the packed
   *  order, and each instance's draw state carried from its previous packed rank to its new one.
   *  A record that left the order leaves its state behind; a new record starts blank. */
  function layOut(next: readonly ClusterRoot<PageRec>[]) {
    const nextPages: PageRec[] = [],
      nextDraws: PageDraw[] = [];
    for (let placement = 0; placement < next.length; placement++) {
      for (const page of next[placement].pages) {
        page.placementIndex = placement;
        const previous = page.packedIndex,
          carried =
            previous !== undefined && pages[previous] === page ? draws[previous] : undefined;
        page.packedIndex = nextPages.length;
        nextPages.push(page);
        nextDraws.push(carried ?? blank(page));
      }
    }
    pages = nextPages;
    draws = nextDraws;
    catalogue = createPageCatalogue(pages);
  }
  layOut(roots);

  /** The state of `rec`, checked against the packed order: a rank another engine wrote yields
   *  nothing. A reader that can do without one uses this; a writer uses `drawing`. */
  const find = (rec: PageRec): PageDraw | undefined => {
    const packed = catalogue.indexOf(rec);
    return packed === undefined ? undefined : draws[packed];
  };
  /** The state of `rec`, which must be laid out: the one accessor every writer goes through. */
  const drawing = (rec: PageRec): PageDraw => {
    const draw = find(rec);
    if (!draw) throw new Error('PAGE_DRAW_MISSING');
    return draw;
  };
  return {
    get pages(): readonly PageRec[] {
      return pages;
    },
    layOut,
    find,
    drawing,
    geometryOf: (rec: PageRec) => find(rec)?.geometry,
    materialOf: (rec: PageRec) => find(rec)?.material,
    /** What a consumer resolves the cut's packed ranks through (`recordOf`). */
    recordOf: (packed: number) => catalogue.recordOf(packed),
    /** Gives back what a record that left the scene owned, before its state is dropped. */
    forget(rec: PageRec) {
      const draw = find(rec);
      if (!draw) return;
      draw.geometry = draw.mesh = undefined;
      draw.material = undefined;
      draw.attached = false;
    },
  };
}
