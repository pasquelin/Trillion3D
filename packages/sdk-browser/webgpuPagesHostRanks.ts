import type { HostRetentionDelta } from './streamingTypes.ts';

export type HostRankDelta = ReturnType<typeof createHostRankDelta>;

/** Ce que la différence lit d'un enregistrement : son rang de requête, et rien d'autre. */
type Ranked = { requestIndex?: number };

/**
 * L'ensemble des rangs de requête qu'une image garde, tenu d'une image à l'autre et publié comme une
 * différence.
 *
 * Rien n'est alloué une fois la scène connue et aucune chaîne n'est touchée : l'appartenance est une
 * marque d'époque lue à même un tableau typé, les sorties se lisent sur la liste des retenus d'avant,
 * et deux tampons échangés évitent la moindre réallocation. Une image qui garde exactement les mêmes
 * rangs publie donc une différence vide, que le cache reconnaît sans rien parcourir.
 */
export function createHostRankDelta(requestCount: number, urls: readonly string[]) {
  const capacity = Math.max(1, requestCount);
  /** L'époque du passage où le rang a été marqué pour la dernière fois. */
  const markedAt = new Int32Array(capacity).fill(-1);
  /** L'appartenance publiée : ce que le cache tient pour épinglé. */
  const published = new Uint8Array(capacity);
  const entered = new Int32Array(capacity),
    exited = new Int32Array(capacity);
  let held = new Int32Array(capacity),
    heldNext = new Int32Array(capacity);
  let epoch = 0,
    heldCount = 0,
    nextCount = 0,
    enteredCount = 0,
    exitedCount = 0;
  const delta = {
    urls,
    entered,
    exited,
    get enteredCount() {
      return enteredCount;
    },
    get exitedCount() {
      return exitedCount;
    },
    get held() {
      return held;
    },
    get heldCount() {
      return heldCount;
    },
  } satisfies HostRetentionDelta;
  return {
    /** Ouvre un passage : ce qui n'est pas remarqué avant `finish()` sortira de l'ensemble. */
    begin() {
      epoch++;
      nextCount = 0;
      enteredCount = 0;
      exitedCount = 0;
    },
    /** Marque les rangs d'une liste. Un rang déjà marqué dans ce passage ne coûte qu'une lecture. */
    mark(list: readonly Ranked[]) {
      for (let i = 0; i < list.length; i++) {
        const rank = list[i].requestIndex;
        if (rank === undefined || rank < 0 || rank >= capacity) continue;
        if (markedAt[rank] === epoch) continue;
        markedAt[rank] = epoch;
        heldNext[nextCount++] = rank;
        if (published[rank]) continue;
        published[rank] = 1;
        entered[enteredCount++] = rank;
      }
    },
    /** Ferme le passage et rend la différence : ce qui est entré, ce qui est sorti. */
    finish(): HostRetentionDelta {
      for (let i = 0; i < heldCount; i++) {
        const rank = held[i];
        if (markedAt[rank] === epoch) continue;
        published[rank] = 0;
        exited[exitedCount++] = rank;
      }
      const swap = held;
      held = heldNext;
      heldNext = swap;
      heldCount = nextCount;
      return delta;
    },
    /** L'ensemble déjà publié, sans rien reparcourir : l'image garde ce qu'elle gardait. */
    hold(): HostRetentionDelta {
      enteredCount = 0;
      exitedCount = 0;
      return delta;
    },
  };
}
