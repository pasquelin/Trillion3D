import type { MathPath } from '../sdk-core/index.ts';
import type { SdkWasm } from './geometryPageWasm.ts';
import { mathClock, mathBatchWasm, mathGovernor, loadMathBatch } from './mathBatchState.ts';
import { blocsJavaScript, reserveArena, type ArenaBloc, type ArenaDemande } from './wasmArena.ts';

/**
 * Ce que tout lot de calcul partage : son tampon, son exécution chronométrée, et la forme de son
 * interface. Les lots eux-mêmes sont dans `mathBatchRuntime.ts` et `mathBatchHierarchy.ts`.
 *
 * Un lot est un TAMPON, pas un appel : l'appelant réserve ses blocs une fois, écrit ses entrées
 * directement dans les vues rendues, appelle `run()` autant de fois qu'il veut, puis rend le tampon.
 * Rien n'est recopié entre JavaScript et WebAssembly — c'est la même mémoire quand le module est là,
 * et de simples tableaux typés quand il ne l'est pas. Le chemin joué est celui que le gouverneur
 * nomme, et `run()` lui rapporte ce que l'exécution a coûté.
 *
 * Les vues se redemandent à chaque usage par `blocs()` : une allocation du module, faite n'importe
 * où, a pu faire grandir sa mémoire et détacher les précédentes. `wasmArena.ts` les reconstruit
 * alors sur les mêmes octets, aux mêmes offsets, sans rien recopier.
 */

export interface MathLot {
  readonly n: number;
  /** Vrai quand les vues sont dans la mémoire du module : le calcul se fait sans aucune copie. */
  readonly shared: boolean;
  /** Vrai quand le lot porte EXACTEMENT `n` éléments et n'a pas été rendu. */
  holds(n: number): boolean;
  /** Joue le lot et rend le chemin RÉELLEMENT exécuté, qui peut différer de celui demandé. */
  run(): MathPath;
  release(): void;
}

export interface Tampon {
  /** Le module quand les blocs vivent dans sa mémoire, `null` quand ils sont dans le tas JavaScript. */
  readonly wasm: SdkWasm | null;
  blocs(): readonly ArenaBloc[];
  release(): void;
}

/** Les blocs du lot, dans la mémoire du module si possible, sinon dans le tas JavaScript. */
export async function tampon(demandes: readonly ArenaDemande[]): Promise<Tampon> {
  await loadMathBatch();
  const wasm = mathBatchWasm();
  const arena = wasm ? reserveArena(wasm, demandes) : null;
  if (wasm && arena) return { wasm, blocs: arena.blocs, release: arena.libere };
  const blocs = blocsJavaScript(demandes);
  return { wasm: null, blocs: () => blocs, release: () => {} };
}

/**
 * Une exécution : le gouverneur choisit, le chronomètre encadre, le gouverneur enregistre. Un chemin
 * WebAssembly demandé mais non gréé retombe sur JavaScript, et c'est ce chemin-là qui est rapporté.
 */
export function joue(
  operation: string,
  n: number,
  wasmRun: (() => void) | null,
  jsRun: () => void,
) {
  const gouverneur = mathGovernor();
  const path: MathPath = gouverneur.choose(operation) === 'wasm' && wasmRun ? 'wasm' : 'js';
  const debut = mathClock();
  if (path === 'wasm' && wasmRun) wasmRun();
  else jsRun();
  const duree = mathClock() - debut;
  gouverneur.observe(operation, path, Number.isFinite(duree) ? duree : null, n);
  return path;
}

export const f64 = (bloc: ArenaBloc) => bloc.vue as Float64Array;
export const u32 = (bloc: ArenaBloc) => bloc.vue as Uint32Array;
export const vuesF64 = (bloc: ArenaBloc) => (bloc.vues ?? []) as readonly Float64Array[];

/** Les `longueur` éléments du bloc `index`, ou zéro quand le tampon a été rendu. */
export const taille = (blocs: readonly ArenaBloc[], index: number) => blocs[index]?.vue.length ?? 0;
