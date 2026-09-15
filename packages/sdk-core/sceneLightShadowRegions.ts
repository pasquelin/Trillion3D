import type { ShadowDirty } from './sceneLightShadowDirty.ts';

/** Champs d'une région : lampe, tranche, face, puis son rectangle de pages, bornes comprises. */
const FIELDS = 7;

/**
 * Les régions de l'image : des rectangles de pages contiguës à redessiner, un appel indirect chacun.
 *
 * Les rangées de pages identiques se regroupent — une face entièrement périmée donne donc **une**
 * région et un seul appel, exactement comme avant ce lot. Une rangée partiellement périmée donne le
 * plus petit rectangle qui la couvre : une page propre redessinée au passage garde la même
 * profondeur, puisque c'est la scène entière qui est redessinée dans le ciseau.
 */
export function createShadowRegions(capacity: number) {
  const data = new Int32Array(capacity * FIELDS);
  let count = 0,
    pages = 0;
  const field = (region: number, index: number) => data[region * FIELDS + index];
  return {
    capacity,
    get count() {
      return count;
    },
    /** Pages que les régions retenues couvrent : l'unité dans laquelle le budget compte le travail. */
    get pages() {
      return pages;
    },
    lightOf: (region: number) => field(region, 0),
    sliceOf: (region: number) => field(region, 1),
    faceOf: (region: number) => field(region, 2),
    x0Of: (region: number) => field(region, 3),
    x1Of: (region: number) => field(region, 4),
    y0Of: (region: number) => field(region, 5),
    y1Of: (region: number) => field(region, 6),
    pagesOf: (region: number) =>
      (field(region, 4) - field(region, 3) + 1) * (field(region, 6) - field(region, 5) + 1),
    reset() {
      count = 0;
      pages = 0;
    },
    /**
     * Découpe la face en rectangles de pages et les retient tant que `admit` les accepte. Chaque
     * région retenue est aussitôt effacée du masque : elle est dessinée par l'image en cours.
     * Rend faux dès que `admit` refuse une région — le reste de la face attend l'image suivante.
     */
    addFace(
      dirty: ShadowDirty,
      light: number,
      slice: number,
      face: number,
      rows: number,
      admit: (pages: number) => boolean,
    ) {
      let row = 0;
      while (row < rows) {
        const bits = dirty.row(slice, face, row);
        if (!bits) {
          row++;
          continue;
        }
        let last = row;
        while (last + 1 < rows && dirty.row(slice, face, last + 1) === bits) last++;
        let x0 = 0,
          x1 = rows - 1;
        while (!((bits >> x0) & 1)) x0++;
        while (!((bits >> x1) & 1)) x1--;
        const area = (x1 - x0 + 1) * (last - row + 1);
        if (count >= capacity || !admit(area)) return false;
        const base = count * FIELDS;
        data[base] = light;
        data[base + 1] = slice;
        data[base + 2] = face;
        data[base + 3] = x0;
        data[base + 4] = x1;
        data[base + 5] = row;
        data[base + 6] = last;
        count++;
        pages += area;
        dirty.drew(slice, face, x0, x1, row, last);
        row = last + 1;
      }
      return true;
    },
  };
}

export type ShadowRegions = ReturnType<typeof createShadowRegions>;
