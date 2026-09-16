/**
 * Contrat de l'intégration d'une page arrivée, hors du fil principal, version 1.
 *
 * Le décodage est déjà hors fil ; ce contrat-ci porte ce qui vient APRÈS : le plan d'intégration
 * d'un paquet de streaming. Rien ici ne touche la plateforme — ni `Worker`, ni horloge, ni DOM.
 * L'adaptateur navigateur porte le transport ; ce fichier ne porte que la forme des messages.
 *
 * Ce que l'exécutant reçoit est une DESCRIPTION, jamais les octets de la page : la fiche d'une
 * requête ne tient que des entiers déjà connus du catalogue (offset dans le paquet, triangles, rang
 * de la page), et la longueur du paquet arrivé suffit au reste. Aucun tampon de cache n'est donc ni
 * copié ni détaché pour être planifié — la question du transfert ne se pose pas.
 */
export const PAGE_INTEGRATION_PROTOCOL = 1;

/** Entiers par enregistrement dans la fiche d'une requête. */
export const PAGE_SPEC_STRIDE = 3;
/** Offset d'octets de l'enregistrement dans le paquet, ou `-1` quand la requête ne porte qu'une page. */
export const SPEC_STREAM_OFFSET = 0;
/** Triangles de l'enregistrement : trois mots d'index chacun. */
export const SPEC_TRIANGLES = 1;
/** Rang de la page dans la table, ou `-1` quand elle n'y figure pas. */
export const SPEC_PAGE_INDEX = 2;

/** Entiers par enregistrement dans le plan rendu. */
export const PAGE_SLICE_STRIDE = 3;
/** Premier mot de l'enregistrement dans le paquet. */
export const SLICE_OFFSET_WORDS = 0;
/** Mots d'index de l'enregistrement. */
export const SLICE_WORDS = 1;
/** Rang de la page, recopié de la fiche : le fil principal ne le cherche plus. */
export const SLICE_PAGE_INDEX = 2;

export interface PageIntegrationRequest {
  protocol: number;
  id: number;
  /** Adresse de la requête arrivée : la clé sous laquelle l'exécutant retient sa fiche. */
  url: string;
  /** Longueur du paquet arrivé, en mots d'index. */
  words: number;
  /**
   * La fiche de la requête, transférée à la première arrivée de cette adresse et `null` ensuite :
   * elle ne dépend que du catalogue, qui ne bouge pas, et l'exécutant la garde.
   */
  specs: ArrayBuffer | null;
}

export interface PageIntegrationDone {
  protocol: number;
  id: number;
  ok: true;
  url: string;
  /** `PAGE_SLICE_STRIDE` entiers par enregistrement, dans l'ordre de la fiche. Transféré. */
  slices: ArrayBuffer;
  /** Enregistrements décrits par `slices`. */
  count: number;
  /** Rangs de page distincts et croissants que l'arrivée fait bouger. Transféré. */
  pages: ArrayBuffer;
  pageCount: number;
  /** Temps de la tâche, mesuré par l'exécutant lui-même. */
  taskMs: number;
}

/**
 * Liste close des refus. `PAGE_INTEGRATION_UNKNOWN` répond à une arrivée dont l'exécutant n'a pas la
 * fiche — un message perdu, ou un exécutant relancé ; `PAGE_INTEGRATION_WORKER` à un exécutant
 * disparu. Les deux autorisent le repli en ligne, qui refait le même plan sur le fil principal.
 */
export const PAGE_INTEGRATION_FAILURES = [
  'PAGE_INTEGRATION_UNKNOWN',
  'PAGE_INTEGRATION_WORKER',
] as const;
export type PageIntegrationFailureCode = (typeof PAGE_INTEGRATION_FAILURES)[number];

export interface PageIntegrationFailed {
  protocol: number;
  id: number;
  ok: false;
  url: string;
  code: PageIntegrationFailureCode;
  message: string;
}

export type PageIntegrationAnswer = PageIntegrationDone | PageIntegrationFailed;
