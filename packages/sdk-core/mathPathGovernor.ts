import { CLOCK_RESOLUTION_MS, Fenetre, estimateClockResolutionMs } from './mathPathWindow.ts';
import {
  MATH_PATH_CONTRACT,
  type MathPath,
  type MathPathMetrics,
  type MathPathMode,
  type MathPathOperation,
} from './mathPathContracts.ts';

/**
 * Gouverneur de chemin de calcul, générique et par opération NOMMÉE : il ne connaît ni les boîtes ni
 * les matrices, seulement des exécutions chronométrées qu'on lui rapporte sous un nom.
 *
 * Il arbitre sur la seule grandeur comparable entre deux tailles de lot : la durée par élément. Pour
 * chaque nom et chaque chemin il tient une médiane glissante — la médiane, et non la moyenne, parce
 * qu'une image en retard ou un ramasse-miettes fait une valeur aberrante et pas une tendance.
 *
 * Il ne bascule que lorsque l'autre chemin est franchement et durablement meilleur, et il garde
 * l'autre médiane fraîche en le jouant de temps en temps. Sans horloge assez fine, il n'arbitre pas
 * du tout : il reste sur le chemin JavaScript, qui est la référence.
 */

/** Exécutions minimales avant tout arbitrage : sous ce nombre, une seule valeur ferait la médiane. */
export const PATH_MIN_SAMPLES = 5;
/** Avance exigée de l'autre chemin. En deçà, l'écart tient au bruit de la machine, pas au code. */
const PATH_SWITCH_MARGIN = 0.2;
/** Exécutions consécutives à cette avance avant de basculer : une rafale, pas un accident. */
export const PATH_SWITCH_RUNS = 5;
/** Une exécution sur autant joue l'autre chemin pour rafraîchir sa médiane sans coûter une image. */
export const PATH_EXPLORE_EVERY = 50;

const NS_PAR_MS = 1e6;

class Operation {
  readonly js = new Fenetre();
  readonly wasm = new Fenetre();
  path: MathPath | null = null;
  runs = 0;
  switches = 0;
  elements = 0;
  /** Exécutions consécutives où l'autre chemin a tenu son avance. Remis à zéro dès qu'elle cède. */
  avance = 0;
}

export interface PathGovernor {
  setMode(mode: MathPathMode): void;
  /** Déclare ce que l'hôte a réussi à charger, et pourquoi le cas échéant. */
  setWasm(available: boolean, simd: boolean | null, reason: string | null): void;
  /** Le chemin à jouer pour la prochaine exécution de cette opération. */
  choose(operation: string): MathPath;
  /** Ce qu'une exécution a coûté. `ms` à `null` : le chrono manque, l'opération repasse au repli. */
  observe(operation: string, path: MathPath, ms: number | null, elements: number): void;
  metrics(): MathPathMetrics;
}

/**
 * Un gouverneur. `now` sert uniquement à estimer la résolution de l'horloge du fil : les durées,
 * elles, sont chronométrées par l'appelant et rapportées à `observe`.
 */
export function createPathGovernor(now: () => number, mode: MathPathMode = 'auto'): PathGovernor {
  const operations = new Map<string, Operation>();
  const resolution = estimateClockResolutionMs(now);
  const grossiere = resolution === null || resolution > CLOCK_RESOLUTION_MS;
  let choisi = mode;
  let disponible = false;
  let simd: boolean | null = null;
  let cause: string | null = 'module WebAssembly non chargé';

  const etat = (nom: string) => {
    let operation = operations.get(nom);
    if (!operation) operations.set(nom, (operation = new Operation()));
    return operation;
  };
  /** L'arbitrage n'est possible que si les deux chemins existent ET que l'horloge les départage. */
  const arbitrable = () => choisi === 'auto' && disponible && !grossiere;

  function choose(nom: string) {
    if (choisi !== 'auto') return disponible || choisi === 'js' ? choisi : 'js';
    if (!arbitrable()) return 'js';
    const operation = etat(nom);
    const courant = operation.path ?? 'wasm';
    // Exploration passive : l'autre chemin tourne une fois sur `PATH_EXPLORE_EVERY`, sans quoi sa
    // médiane vieillirait jusqu'à décrire une machine qui n'existe plus.
    const autre = courant === 'js' ? 'wasm' : 'js';
    return operation.runs % PATH_EXPLORE_EVERY === PATH_EXPLORE_EVERY - 1 ? autre : courant;
  }

  function observe(nom: string, path: MathPath, ms: number | null, elements: number) {
    const operation = etat(nom);
    operation.runs++;
    if (elements <= 0) return;
    operation.elements += elements;
    if (ms === null) {
      // Un chrono manquant ne prouve rien : l'opération retombe sur la référence et y reste tant
      // qu'aucune exécution chronométrée n'a nourri les deux médianes.
      operation.path = 'js';
      operation.avance = 0;
      return;
    }
    operation[path].ajoute((ms * NS_PAR_MS) / elements);
    operation.path ??= path;
    if (!arbitrable()) return;
    const courant = operation.path;
    const autre = courant === 'js' ? 'wasm' : 'js';
    const iciMediane = operation[courant].mediane();
    const laMediane = operation[autre].mediane();
    const assez =
      operation[courant].count >= PATH_MIN_SAMPLES && operation[autre].count >= PATH_MIN_SAMPLES;
    if (!assez || iciMediane === null || laMediane === null) return;
    if (laMediane < iciMediane * (1 - PATH_SWITCH_MARGIN)) operation.avance++;
    else operation.avance = 0;
    if (operation.avance >= PATH_SWITCH_RUNS) {
      operation.path = autre;
      operation.switches++;
      operation.avance = 0;
    }
  }

  function metrics(): MathPathMetrics {
    const releve: Record<string, MathPathOperation> = {};
    for (const [nom, operation] of operations)
      releve[nom] = {
        path: operation.path,
        jsNsPerElement: operation.js.mediane(),
        wasmNsPerElement: operation.wasm.mediane(),
        jsSamples: operation.js.count,
        wasmSamples: operation.wasm.count,
        switches: operation.switches,
        elements: operation.elements,
      };
    return {
      contract: MATH_PATH_CONTRACT,
      mode: choisi,
      wasmAvailable: disponible,
      wasmSimd: simd,
      clockResolutionMs: resolution,
      clockCoarse: grossiere,
      unavailableReason: cause,
      operations: releve,
    };
  }

  return {
    setMode: (valeur) => {
      choisi = valeur;
    },
    setWasm: (available, simdActif, raison) => {
      disponible = available;
      simd = simdActif;
      cause = raison;
    },
    choose,
    observe,
    metrics,
  };
}
