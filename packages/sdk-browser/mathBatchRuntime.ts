import {
  BOX_VALUES,
  MATRIX_VALUES,
  boxTransformBatch,
  multiplyMatrix4Batch,
  type MathPath,
} from '../sdk-core/index.ts';
import { mathClock, mathBatchWasm, mathGovernor, prepareMathBatch } from './mathBatchState.ts';
import { blocsJavaScript, reserveArena, type ArenaBloc, type ArenaDemande } from './wasmArena.ts';

/**
 * Les deux lots portés par le POC : la transformation de boîtes et le produit de matrices 4×4, les
 * deux opérations dont le coût du moteur est proportionnel au nombre d'éléments.
 *
 * Un lot est un TAMPON, pas un appel : l'appelant réserve ses blocs une fois, écrit ses entrées
 * directement dans les vues rendues, appelle `run()` autant de fois qu'il veut, puis rend le tampon.
 * Rien n'est recopié entre JavaScript et WebAssembly — c'est la même mémoire quand le module est là,
 * et de simples `Float64Array` quand il ne l'est pas. Le chemin joué est celui que le gouverneur
 * nomme, et `run()` lui rapporte ce que l'exécution a coûté.
 */

/** Les noms sous lesquels le gouverneur tient ses médianes. */
export const BOX_TRANSFORM_BATCH = 'boxTransformBatch';
export const MULTIPLY_MATRIX4_BATCH = 'multiplyMatrix4Batch';

export interface MathLot {
  readonly n: number;
  /** Vrai quand les vues sont dans la mémoire du module : le calcul se fait sans aucune copie. */
  readonly shared: boolean;
  /** Joue le lot et rend le chemin RÉELLEMENT exécuté, qui peut différer de celui demandé. */
  run(): MathPath;
  release(): void;
}

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

/** Les blocs du lot, dans la mémoire du module si possible, sinon dans le tas JavaScript. */
async function tampon(demandes: readonly ArenaDemande[]) {
  await prepareMathBatch();
  const wasm = mathBatchWasm();
  const arena = wasm ? reserveArena(wasm, demandes) : null;
  if (wasm && arena) return { wasm, blocs: arena.blocs, release: arena.libere };
  return { wasm: null, blocs: blocsJavaScript(demandes), release: () => {} };
}

/**
 * Une exécution : le gouverneur choisit, le chronomètre encadre, le gouverneur enregistre. Un chemin
 * WebAssembly demandé mais non gréé retombe sur JavaScript, et c'est ce chemin-là qui est rapporté.
 */
function joue(operation: string, n: number, wasmRun: (() => void) | null, jsRun: () => void) {
  const gouverneur = mathGovernor();
  const path: MathPath = gouverneur.choose(operation) === 'wasm' && wasmRun ? 'wasm' : 'js';
  const debut = mathClock();
  if (path === 'wasm' && wasmRun) wasmRun();
  else jsRun();
  const duree = mathClock() - debut;
  gouverneur.observe(operation, path, Number.isFinite(duree) ? duree : null, n);
  return path;
}

const f64 = (bloc: ArenaBloc) => bloc.vue as Float64Array;
const vuesF64 = (bloc: ArenaBloc) => (bloc.vues ?? []) as readonly Float64Array[];

/** Un lot de `n` boîtes transformées par `n` matrices. */
export async function createBoxTransformLot(n: number): Promise<BoxTransformLot> {
  const { wasm, blocs, release } = await tampon([
    { type: 'f64', longueur: n * BOX_VALUES },
    { type: 'f64', longueur: n * MATRIX_VALUES, pas: MATRIX_VALUES },
    { type: 'f64', longueur: n * BOX_VALUES },
  ]);
  const [entree, matrices, sortie] = blocs;
  const boxes = f64(entree),
    mats = f64(matrices),
    out = f64(sortie);
  const matViews = vuesF64(matrices);
  const wasmRun = wasm
    ? () => wasm.math_box_transform_batch(sortie.offset, entree.offset, matrices.offset, n)
    : null;
  return {
    n,
    shared: wasm !== null,
    boxes,
    mats,
    out,
    run: () =>
      joue(BOX_TRANSFORM_BATCH, n, wasmRun, () => boxTransformBatch(out, boxes, matViews, n)),
    release,
  };
}

/** Un lot de `n` produits `out[i] = a[i] · b[i]`. */
export async function createMultiplyLot(n: number): Promise<MultiplyLot> {
  const demande = { type: 'f64', longueur: n * MATRIX_VALUES, pas: MATRIX_VALUES } as const;
  const { wasm, blocs, release } = await tampon([demande, demande, demande]);
  const [gauche, droite, sortie] = blocs;
  const wasmRun = wasm
    ? () => wasm.math_multiply_matrix4_batch(sortie.offset, gauche.offset, droite.offset, n)
    : null;
  const outViews = vuesF64(sortie),
    aViews = vuesF64(gauche),
    bViews = vuesF64(droite);
  return {
    n,
    shared: wasm !== null,
    a: f64(gauche),
    b: f64(droite),
    out: f64(sortie),
    run: () =>
      joue(MULTIPLY_MATRIX4_BATCH, n, wasmRun, () =>
        multiplyMatrix4Batch(outViews, aViews, bViews, n),
      ),
    release,
  };
}
