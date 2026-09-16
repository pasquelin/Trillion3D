/**
 * Contrat publié du gouverneur de chemin de calcul (`mathPathGovernor.ts`), version 1.
 *
 * Ce que l'hôte lit dans les métriques est ce que le gouverneur a MESURÉ, jamais une estimation :
 * une médiane qu'aucune exécution n'a nourrie vaut `null`, et un chemin qu'aucune décision n'a
 * encore arrêté vaut `null` lui aussi. Zéro dirait « mesuré à zéro ».
 */

/** Les deux chemins portés. Le JavaScript est la référence et le repli ; le Wasm est l'accéléré. */
export type MathPath = 'js' | 'wasm';
/** Ce qu'un hôte demande : un chemin imposé pour une campagne, ou l'arbitrage par la mesure. */
export type MathPathMode = MathPath | 'auto';

/** Version du contrat de ce relevé. Un hôte qui ne la connaît pas ne lit pas les champs. */
export const MATH_PATH_CONTRACT = 1;

/** Le relevé d'une opération en lot nommée. */
export interface MathPathOperation {
  /** Le chemin que la prochaine exécution jouera, `null` tant qu'aucune n'a eu lieu. */
  path: MathPath | null;
  /** Médiane glissante de la durée par élément, en nanosecondes ; `null` si non mesurée. */
  jsNsPerElement: number | null;
  wasmNsPerElement: number | null;
  /** Exécutions retenues dans chaque médiane. */
  jsSamples: number;
  wasmSamples: number;
  /** Bascules décidées depuis le début de la session. */
  switches: number;
  /** Éléments traités depuis le début de la session, tous chemins confondus. */
  elements: number;
}

/** L'état du gouverneur pour toute la session. */
export interface MathPathMetrics {
  contract: number;
  mode: MathPathMode;
  /** Le module WebAssembly est chargé, à la bonne version de contrat. */
  wasmAvailable: boolean;
  /** Le module a été compilé avec `simd128` ; `null` tant qu'aucun module n'est chargé. */
  wasmSimd: boolean | null;
  /** Résolution de l'horloge du fil, en millisecondes ; `null` tant qu'elle n'a pas été estimée. */
  clockResolutionMs: number | null;
  /** Vrai quand l'horloge est trop grossière pour arbitrer : tout reste sur le chemin JavaScript. */
  clockCoarse: boolean;
  /** Pourquoi le chemin WebAssembly n'est pas jouable, ou `null` quand il l'est. */
  unavailableReason: string | null;
  operations: Record<string, MathPathOperation>;
}
