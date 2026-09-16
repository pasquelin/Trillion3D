import type { Job } from './streamingTypes.ts';

/**
 * Le rang d'insertion d'une priorité dans une file déjà en ordre : le premier travail que celle-ci
 * précède. Une recherche dichotomique, donc un logarithme de comparaisons là où retrier toute la
 * file en coûtait `n log n` — et une caméra en mouvement empile des demandes à chaque image.
 */
export function rangDInsertion(queue: readonly { priority: number }[], priority: number) {
  let low = 0,
    high = queue.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (queue[mid].priority <= priority) low = mid + 1;
    else high = mid;
  }
  return low;
}

/**
 * Pose un travail à sa place dans une file tenue en ordre. Son numéro d'arrivée est le plus grand
 * jamais posé : il va donc en queue de son groupe de priorité, et l'ordre est conservé sans tri.
 */
export function insereTravail(queue: Job[], job: Job) {
  const at = rangDInsertion(queue, job.priority);
  if (at === queue.length) queue.push(job);
  else queue.splice(at, 0, job);
}

/**
 * Retire de la file, en un seul passage et sans déranger l'ordre, les travaux qu'une annulation a
 * marqués. Une rafale d'annulations — ce qu'une caméra rapide produit à chaque image — payait
 * jusqu'ici un balayage de la file par demande abandonnée pour y retrouver sa place.
 */
export function compacteFile(queue: Job[]) {
  let garde = 0;
  for (let i = 0; i < queue.length; i++)
    if (queue[i].state !== 'dropped') queue[garde++] = queue[i];
  queue.length = garde;
}

/**
 * Le premier travail que le budget de transfert laisse partir, ou -1. Le premier transfert d'une
 * file part toujours : sans lui rien n'avancerait quand une seule page dépasse le budget.
 */
export function findAdmissible(
  queue: readonly { url: string }[],
  active: number,
  activeBytes: number,
  bytesOf: (url: string) => number | undefined,
  maxTransferBytes: number,
) {
  for (let i = 0; i < queue.length; i++)
    if (active === 0 || activeBytes + (bytesOf(queue[i].url) ?? 0) <= maxTransferBytes) return i;
  return -1;
}
