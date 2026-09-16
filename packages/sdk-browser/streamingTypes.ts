import type { BackendDiagnostic } from './backendTypes.ts';

/**
 * Ce qu'une image dit au cache des pages qu'elle garde : une différence de RANGS de requête, pas une
 * liste d'adresses. Le rang est posé une fois pour toutes par le catalogue, `urls` le traduit, et
 * seules les entrées et les sorties sont parcourues — une coupe de quinze mille pages qui n'en
 * change que dix ne coûte donc plus dix mille hachages de chaînes par image. `held` porte
 * l'appartenance entière : elle sert à reprendre la main quand un autre moteur a écrit les épingles.
 */
export interface HostRetentionDelta {
  /** Rang de requête → adresse. La même table pour la vie de la scène : son identité dit l'émetteur. */
  readonly urls: readonly string[];
  readonly entered: Int32Array;
  readonly enteredCount: number;
  readonly exited: Int32Array;
  readonly exitedCount: number;
  readonly held: Int32Array;
  readonly heldCount: number;
}

export interface StreamPage {
  url: string;
  bytes: number;
  sha256: string;
}
export type Job = {
  url: string;
  priority: number;
  order: number;
  controller: AbortController;
  /** `dropped` : plus aucun consommateur, la file le laisse tomber au prochain passage de `pump`. */
  state: 'queued' | 'active' | 'dropped';
  consumers: Set<symbol>;
  promise: Promise<Uint8Array>;
  resolve: (value: Uint8Array) => void;
  reject: (reason: unknown) => void;
};

export type StreamContext = {
  base: string;
  catalog: Map<string, StreamPage>;
  cache: Map<string, Uint8Array>;
  jobs: Map<string, Job>;
  queue: Job[];
  pinned: Set<string>;
  failures: Map<string, Error>;
  abort: AbortController;
  limit: number;
  maxPages?: number;
  maxTransferBytes: number;
  maxCachedBytes: number;
  onEvict?: (url: string) => void;
  onDiagnostic?: (diagnostic: BackendDiagnostic) => void;
  state: {
    order: number;
    active: number;
    activeBytes: number;
    requested: number;
    hits: number;
    misses: number;
    bytesRead: number;
    loaded: number;
    evictions: number;
    admissionBlocked: number;
    /** Travaux marqués abandonnés mais encore dans le tableau de la file. */
    dropped: number;
    disposed: boolean;
    cachedBytes: number;
  };
  emit: (phase: string, message: string, context: () => Record<string, unknown>) => void;
  abortError: () => DOMException;
};
