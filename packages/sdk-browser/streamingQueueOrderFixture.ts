/**
 * L'ordre d'admission d'une file, écrit tel quel : priorité, puis ordre d'arrivée. Le moteur ne trie
 * plus — il tient la file en ordre par insertion — mais l'oracle reste la définition de cet ordre,
 * et c'est contre lui que les tests et les bancs vérifient l'insertion.
 */
export function sortStreamJobs(queue: { priority: number; order: number }[]) {
  queue.sort((a, b) => a.priority - b.priority || a.order - b.order);
}
