import type { MathPathMetrics, MathPathMode } from '../sdk-core/index.ts';
import { createPathGovernor, type PathGovernor } from '../sdk-core/index.ts';
import { prepareSdkWasm, type SdkWasm } from './geometryPageWasm.ts';
import { WASM_ARENA_CONTRACT } from './wasmArena.ts';

/**
 * L'état de session du calcul en lot : un gouverneur, un module WebAssembly, une décision de
 * disponibilité. Tout le reste — les lots eux-mêmes — est dans `mathBatchRuntime.ts`.
 *
 * Le module est celui du SDK, déjà chargé pour le décodage des pages : aucune seconde instanciation,
 * aucune seconde mémoire linéaire. S'il manque, si son contrat de calcul n'est pas celui que ce
 * chargeur connaît, ou si l'horloge du fil est trop grossière pour départager deux chemins, tout
 * reste sur le chemin JavaScript et la raison est publiée — jamais un repli silencieux.
 */

/** L'horloge du fil. `performance.now()` là où il existe, sinon la seule horloge disponible. */
export function mathClock() {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

let gouverneur: PathGovernor | null = null;
let module: SdkWasm | null = null;
let attente: Promise<void> | null = null;

/** Le gouverneur de la session, créé à la première demande. */
export function mathGovernor(): PathGovernor {
  gouverneur ??= createPathGovernor(mathClock);
  return gouverneur;
}

/**
 * Charge le module une fois pour la session et déclare au gouverneur ce qui est jouable. `mode`
 * impose un chemin pour une campagne (`'js'` ou `'wasm'`) ou laisse la mesure arbitrer (`'auto'`).
 */
export function prepareMathBatch(mode: MathPathMode): Promise<void> {
  mathGovernor().setMode(mode);
  return loadMathBatch();
}

/** Le module, chargé une fois pour la session ; le mode du gouverneur n'y touche pas. */
export function loadMathBatch(): Promise<void> {
  const g = mathGovernor();
  attente ??= (async () => {
    const wasm = await prepareSdkWasm();
    if (!wasm) return g.setWasm(false, null, 'module WebAssembly indisponible');
    const contrat = typeof wasm.math_contract === 'function' ? wasm.math_contract() : 0;
    if (contrat !== WASM_ARENA_CONTRACT)
      return g.setWasm(
        false,
        null,
        `contrat de calcul ${contrat} ; ce chargeur attend ${WASM_ARENA_CONTRACT}`,
      );
    module = wasm;
    g.setWasm(true, wasm.math_simd() === 1, null);
  })();
  return attente;
}

/** Le module utilisable pour les lots, ou `null` tant que le chemin WebAssembly n'est pas ouvert. */
export function mathBatchWasm(): SdkWasm | null {
  return module;
}

/** L'état publié dans les métriques et dans les capacités. */
export function mathBatchMetrics(): MathPathMetrics {
  return mathGovernor().metrics();
}
