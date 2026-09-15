/**
 * File d'arrivées de pages d'index : ce qui arrive du cache ou du réseau n'entre plus dans l'image qui
 * l'a découvert. Chaque arrivée est empilée, puis un drain unique et borné, en tête de l'image
 * suivante, la fait résider avant la sélection. Une image ne porte donc jamais plus que ce budget
 * d'écritures d'index, et la rafale d'un lot entier ne tombe plus au milieu d'un `renderer.render`.
 * L'ordre d'arrivée est conservé : un drain reprend exactement là où le précédent s'est arrêté.
 */

/** Ce que la file exige d'un destinataire : de quoi recevoir une page et refaire sa résidence. */
export type ArrivalTarget = {
  acceptPage?(url: string, array: Uint32Array): void;
  syncResident?(): void;
};

export function createArrivalQueue(byteBudget: number, countBudget: number) {
  const items: Array<{ target: ArrivalTarget; url: string; array: Uint32Array }> = [];
  // Une même page peut être vue par le cache puis par la fin de son téléchargement : tant qu'elle
  // attend, elle ne s'empile qu'une fois par destinataire. L'attente est oubliée dès la livraison.
  const waiting = new Map<ArrivalTarget, Set<string>>(),
    touched: ArrivalTarget[] = [],
    // Appartenance en temps constant : `touched.includes` redevenait quadratique sur un gros drain.
    touchedSet = new Set<ArrivalTarget>();
  let head = 0;
  return {
    /** Arrivées encore en attente de drain. */
    get pending() {
      return items.length - head;
    },
    /** Empile une page pour un destinataire ; sans `acceptPage` il n'a rien à en faire. */
    queue(target: ArrivalTarget, url: string, array: Uint32Array) {
      if (!target.acceptPage) return false;
      let urls = waiting.get(target);
      if (!urls) {
        urls = new Set();
        waiting.set(target, urls);
      }
      if (urls.has(url)) return false;
      urls.add(url);
      items.push({ target, url, array });
      return true;
    },
    /**
     * Livre les arrivées jusqu'au budget — au plus `countBudget` pages, et on s'arrête dès que
     * `byteBudget` octets d'index ont été écrits —, puis un seul `syncResident` par destinataire
     * touché. Renvoie le nombre de pages livrées.
     */
    drain() {
      if (head >= items.length) return 0;
      let bytes = 0,
        count = 0;
      touched.length = 0;
      touchedSet.clear();
      while (head < items.length && bytes < byteBudget && count < countBudget) {
        const item = items[head++];
        waiting.get(item.target)?.delete(item.url);
        item.target.acceptPage?.(item.url, item.array);
        bytes += item.array.byteLength;
        count++;
        if (!touchedSet.has(item.target)) {
          touchedSet.add(item.target);
          touched.push(item.target);
        }
      }
      if (head >= items.length) {
        items.length = 0;
        head = 0;
      }
      for (let i = 0; i < touched.length; i++) touched[i].syncResident?.();
      return count;
    },
  };
}
