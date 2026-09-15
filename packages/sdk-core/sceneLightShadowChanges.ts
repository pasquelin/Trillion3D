/** Boîtes de mouvement gardées séparément avant fusion : au-delà, deux boîtes se rejoignent. */
export const MOVED_BOXES = 8;

/** Le point testé, alloué une fois : `touches` est appelé par lampe et par boîte, à chaque image. */
const point = new Float64Array(3);
/** La boîte lue, allouée une fois : l'ordonnanceur la projette face par face sans rien créer. */
const readMin = new Float64Array(3),
  readMax = new Float64Array(3),
  readBox = { min: readMin, max: readMax };

/**
 * Ce qui a bougé dans le monde depuis la dernière image, en boîtes monde. Elles sont gardées
 * **séparées** — jusqu'à huit — et non réunies en une seule : une seule boîte englobant deux objets
 * aux deux bouts de la scène périmerait toutes les pages entre eux, alors que rien n'y a changé.
 * Au-delà de huit, deux boîtes fusionnent, celles dont la réunion coûte le moins de volume.
 *
 * L'ordonnanceur les consomme à chaque image : il en déduit les pages périmées de chaque face, qui
 * portent ensuite l'état. Les boîtes n'ont donc rien à retenir d'une image à l'autre, et tout est
 * alloué une fois.
 */
export function createShadowChanges() {
  const min = new Float64Array(MOVED_BOXES * 3),
    max = new Float64Array(MOVED_BOXES * 3);
  let count = 0;
  const volume = (base: number, lo: ArrayLike<number>, hi: ArrayLike<number>) => {
    let product = 1;
    for (let axis = 0; axis < 3; axis++)
      product *= Math.max(max[base + axis], hi[axis]) - Math.min(min[base + axis], lo[axis]);
    return product;
  };
  const own = (base: number) =>
    (max[base] - min[base]) * (max[base + 1] - min[base + 1]) * (max[base + 2] - min[base + 2]);
  const write = (base: number, lo: ArrayLike<number>, hi: ArrayLike<number>, merge: boolean) => {
    for (let axis = 0; axis < 3; axis++) {
      min[base + axis] = merge ? Math.min(min[base + axis], lo[axis]) : lo[axis];
      max[base + axis] = merge ? Math.max(max[base + axis], hi[axis]) : hi[axis];
    }
  };
  return {
    get count() {
      return count;
    },
    min,
    max,
    /** Un nœud ou une page de résidence a bougé : sa boîte entre dans la liste, ou rejoint une voisine. */
    worldChanged(lo: readonly number[], hi: readonly number[]) {
      if (count < MOVED_BOXES) {
        write(count * 3, lo, hi, false);
        count++;
        return;
      }
      let best = 0,
        bestGrowth = Infinity;
      for (let box = 0; box < count; box++) {
        const growth = volume(box * 3, lo, hi) - own(box * 3);
        if (growth < bestGrowth) {
          bestGrowth = growth;
          best = box;
        }
      }
      write(best * 3, lo, hi, true);
    },
    /**
     * La sphère d'influence d'une lampe contre la boîte `box` : un test analytique, pas un rayon. Une
     * lampe sans portée — le soleil — voit tout ce qui bouge, et rend donc toujours vrai.
     */
    touches(box: number, x: number, y: number, z: number, range: number) {
      const base = box * 3;
      if (!(range > 0)) return true;
      let squared = 0;
      point[0] = x;
      point[1] = y;
      point[2] = z;
      for (let axis = 0; axis < 3; axis++) {
        const gap = Math.max(min[base + axis] - point[axis], point[axis] - max[base + axis], 0);
        squared += gap * gap;
      }
      return squared <= range * range;
    },
    /** La boîte `box` dans deux tableaux réutilisés : `[0]` ses minima, `[1]` ses maxima. */
    read(box: number) {
      const base = box * 3;
      for (let axis = 0; axis < 3; axis++) {
        readMin[axis] = min[base + axis];
        readMax[axis] = max[base + axis];
      }
      return readBox;
    },
    /** Les boîtes sont consommées : les pages qu'elles périment portent désormais l'état. */
    settled() {
      count = 0;
    },
  };
}
