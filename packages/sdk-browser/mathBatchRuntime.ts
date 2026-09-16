import {
  BOX_VALUES,
  MATRIX_VALUES,
  boxTransformBatch,
  multiplyMatrix4Batch,
} from '../sdk-core/index.ts';
import { f64, joue, taille, tampon, vuesF64, type MathLot } from './mathBatchLot.ts';

/**
 * Les deux lots de départ : la transformation de boîtes et le produit de matrices 4×4, les deux
 * opérations dont le coût du moteur est proportionnel au nombre d'éléments. `mathBatchLot.ts` porte
 * le tampon, l'exécution chronométrée et la forme commune.
 *
 * Les tampons sont exposés en ACCESSEURS et non en champs figés : chaque lecture redemande les vues
 * au tampon, qui les reconstruit si la mémoire du module a grandi entre-temps. Un appelant écrit
 * donc toujours dans des octets vivants, sans jamais savoir qu'une croissance a eu lieu.
 */

/** Les noms sous lesquels le gouverneur tient ses médianes, et les clés du relevé publié. */
const BOX_TRANSFORM_BATCH = 'boxTransformBatch';
const MULTIPLY_MATRIX4_BATCH = 'multiplyMatrix4Batch';

export interface BoxTransformLot extends MathLot {
  /** `6 · n` nombres : les boîtes d'entrée, `minX, minY, minZ, maxX, maxY, maxZ` par élément. */
  readonly boxes: Float64Array;
  /** `16 · n` nombres : les matrices colonne-major. */
  readonly mats: Float64Array;
  /** `6 · n` nombres : les boîtes transformées. */
  readonly out: Float64Array;
}

export interface MultiplyLot extends MathLot {
  readonly a: Float64Array;
  readonly b: Float64Array;
  readonly out: Float64Array;
}

/** Un lot de `n` boîtes transformées par `n` matrices. */
export async function createBoxTransformLot(n: number): Promise<BoxTransformLot> {
  const { wasm, blocs, release } = await tampon([
    { type: 'f64', longueur: n * BOX_VALUES },
    { type: 'f64', longueur: n * MATRIX_VALUES, pas: MATRIX_VALUES },
    { type: 'f64', longueur: n * BOX_VALUES },
  ]);
  const [entree, matrices, sortie] = blocs().map((bloc) => bloc.offset);
  const wasmRun = wasm ? () => wasm.math_box_transform_batch(sortie, entree, matrices, n) : null;
  return {
    n,
    shared: wasm !== null,
    get boxes() {
      return f64(blocs()[0]);
    },
    get mats() {
      return f64(blocs()[1]);
    },
    get out() {
      return f64(blocs()[2]);
    },
    holds: (count) => count > 0 && taille(blocs(), 0) === count * BOX_VALUES,
    run: () => {
      const b = blocs();
      return joue(BOX_TRANSFORM_BATCH, n, wasmRun, () =>
        boxTransformBatch(f64(b[2]), f64(b[0]), vuesF64(b[1]), n),
      );
    },
    release,
  };
}

/** Un lot de `n` produits `out[i] = a[i] · b[i]`. */
export async function createMultiplyLot(n: number): Promise<MultiplyLot> {
  const demande = { type: 'f64', longueur: n * MATRIX_VALUES, pas: MATRIX_VALUES } as const;
  const { wasm, blocs, release } = await tampon([demande, demande, demande]);
  const [gauche, droite, sortie] = blocs().map((bloc) => bloc.offset);
  const wasmRun = wasm ? () => wasm.math_multiply_matrix4_batch(sortie, gauche, droite, n) : null;
  return {
    n,
    shared: wasm !== null,
    get a() {
      return f64(blocs()[0]);
    },
    get b() {
      return f64(blocs()[1]);
    },
    get out() {
      return f64(blocs()[2]);
    },
    holds: (count) => count > 0 && taille(blocs(), 0) === count * MATRIX_VALUES,
    run: () => {
      const b = blocs();
      return joue(MULTIPLY_MATRIX4_BATCH, n, wasmRun, () =>
        multiplyMatrix4Batch(vuesF64(b[2]), vuesF64(b[0]), vuesF64(b[1]), n),
      );
    },
    release,
  };
}
