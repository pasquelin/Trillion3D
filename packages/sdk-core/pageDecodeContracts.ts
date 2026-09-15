/**
 * Contrat du décodage d'une page hors du fil principal, version 1.
 *
 * Le fil appelant envoie une `PageDecodeRequest`, l'exécutant rend une `PageDecodeAnswer` portant le
 * même `id`. Rien ici ne touche la plateforme : ni `Worker`, ni fetch, ni horloge — l'adaptateur
 * navigateur porte tout cela, ce fichier ne porte que la forme des messages, la liste close des
 * échecs et la borne du pool.
 *
 * Propriété des tampons : `source` est **transféré** avec la requête, donc l'émetteur ne le possède
 * plus. Une réponse `verify` le rend, transféré à son tour ; une réponse `decode` rend à la place les
 * tampons décodés, eux aussi transférés. Un exécutant qui ne transfère rien (le repli synchrone) rend
 * exactement les mêmes valeurs : le contrat ne dit pas comment le travail voyage, seulement ce qu'il
 * rend.
 */
export const PAGE_DECODE_PROTOCOL = 1;

/** `verify` : l'empreinte SHA-256 d'une page. `decode` : ses indices et ses attributs par sommet. */
export type PageDecodeOp = 'verify' | 'decode';

export interface PageDecodeRequest {
  protocol: number;
  id: number;
  op: PageDecodeOp;
  /** Transféré avec le message : l'émetteur n'en est plus propriétaire. */
  source: ArrayBuffer;
  /** Plafond d'octets décodés d'une page de géométrie ; ignoré par `verify`. */
  maxDecodedBytes: number;
}

/** Annulation d'une requête encore en file. Un travail déjà commencé va à son terme puis répond
 *  `PAGE_DECODE_CANCELLED` : l'exécutant n'a pas de point d'interruption au milieu d'un décodage. */
export interface PageDecodeCancel {
  protocol: number;
  id: number;
  op: 'cancel';
}

/** Les tampons d'une page décodée. `names[i]` nomme `attributes[i]`, dans l'ordre d'écriture du
 *  décodage : c'est cet ordre qui redonne un `Record` identique champ pour champ. */
export interface PageDecodeGeometryPayload {
  indices: ArrayBuffer;
  names: string[];
  attributes: ArrayBuffer[];
  vertexCount: number;
  flags: number;
  decodedBytes: number;
}

export interface PageDecodeDone {
  protocol: number;
  id: number;
  ok: true;
  /** `verify` : l'empreinte hexadécimale minuscule. `decode` : `null`. */
  sha256: string | null;
  /** `verify` : le tampon source rendu. `decode` : `null`, la source est consommée. */
  source: ArrayBuffer | null;
  decoded: PageDecodeGeometryPayload | null;
  /** Temps de la tâche, mesuré par l'exécutant lui-même. */
  taskMs: number;
}

/**
 * Sémantique d'échec, liste close. Les six premiers sont les refus du décodage de page, repris mot
 * pour mot de `geometryPage.ts` : un appelant les distingue comme avant. `PAGE_DECODE_FAILED` porte
 * tout autre refus de la bibliothèque de décompression. `PAGE_DECODE_CANCELLED` répond à une
 * annulation, `PAGE_DECODE_WORKER` à un exécutant qui a disparu — seul celui-là autorise le repli.
 */
export const PAGE_DECODE_FAILURES = [
  'GEOMETRY_PAGE_HEADER',
  'GEOMETRY_PAGE_VERSION',
  'GEOMETRY_PAGE_BOUNDS',
  'GEOMETRY_PAGE_INDEX',
  'GEOMETRY_PAGE_NONFINITE',
  'PAGE_DECODE_FAILED',
  'PAGE_DECODE_CANCELLED',
  'PAGE_DECODE_WORKER',
] as const;
export type PageDecodeFailureCode = (typeof PAGE_DECODE_FAILURES)[number];

export interface PageDecodeFailed {
  protocol: number;
  id: number;
  ok: false;
  code: PageDecodeFailureCode;
  /** Le message d'origine, tel quel : l'appelant relève la même `Error` que le chemin synchrone. */
  message: string;
}
export type PageDecodeAnswer = PageDecodeDone | PageDecodeFailed;

/** Le refus nommé qui correspond à un message, ou `PAGE_DECODE_FAILED` pour tout le reste. */
export function pageDecodeFailureCode(message: string): PageDecodeFailureCode {
  for (const code of PAGE_DECODE_FAILURES) if (code === message) return code;
  return 'PAGE_DECODE_FAILED';
}

/**
 * La taille du pool de décodage : jamais plus que les cœurs annoncés par la machine, jamais plus que
 * le plafond du paquet, jamais plus que la borne d'admission déjà en vigueur sur les transferts, et
 * au moins un. Une valeur absente ou non entière vaut un seul exécutant : sur une plateforme qui
 * n'annonce rien, on n'invente pas de parallélisme.
 */
export function pageDecodeWorkerCount(
  hardwareConcurrency: number | undefined,
  admissionLimit: number,
  ceiling = 4,
) {
  const cores = Number.isSafeInteger(hardwareConcurrency) ? (hardwareConcurrency as number) : 1;
  const admission = Number.isSafeInteger(admissionLimit) ? admissionLimit : 1;
  return Math.max(1, Math.min(cores, ceiling, admission));
}
