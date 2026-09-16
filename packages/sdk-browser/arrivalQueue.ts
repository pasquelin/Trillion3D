/**
 * File d'arrivées de pages d'index : ce qui arrive du cache ou du réseau n'entre plus dans l'image qui
 * l'a découvert. Chaque arrivée est empilée, puis un drain unique et borné, en tête de l'image
 * suivante, la fait résider avant la sélection. Une image ne porte donc jamais plus que ce budget
 * d'intégration, et la rafale d'un lot entier ne tombe plus au milieu d'un `renderer.render`.
 * L'ordre d'arrivée est conservé : un drain reprend exactement là où le précédent s'est arrêté, et
 * l'ordre dans lequel l'image a nommé ses pages manquantes est déjà celui de sa priorité — le plus
 * coûteux à manquer d'abord.
 *
 * Le plafond qui compte est celui du TEMPS. Une arrivée porte un paquet de streaming dont le nombre
 * de clusters n'est pas connu d'avance : ni les octets d'index, ni le nombre de pages ne bornent
 * donc la durée qu'elle coûte. Le drain relit l'horloge après chaque livraison et rend la main dès
 * le plafond atteint ; le reste attend l'image suivante. Une livraison au moins passe toujours, sans
 * quoi une page plus longue à intégrer que le plafond n'entrerait jamais.
 */

/** Ce que la file exige d'un destinataire : de quoi recevoir une page avant le prochain rendu. */
export type ArrivalTarget = {
  acceptPage?(url: string, array: Uint32Array): void;
};

export function createArrivalQueue(byteBudget: number, countBudget: number, msBudget = 2) {
  const items: Array<{ target: ArrivalTarget; url: string; array: Uint32Array }> = [];
  // Une même page peut être vue par le cache puis par la fin de son téléchargement : tant qu'elle
  // attend, elle ne s'empile qu'une fois par destinataire. L'attente est oubliée dès la livraison.
  const waiting = new Map<ArrivalTarget, Set<string>>();
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
     * Livre les arrivées jusqu'au budget — au plus `countBudget` pages, `byteBudget` octets d'index
     * et `msBudget` millisecondes passées à les intégrer. Le rendu qui suit synchronise la résidence ;
     * appeler `syncResident` ici pourrait dessiner une seconde image. Renvoie les pages livrées.
     */
    drain() {
      if (head >= items.length) return 0;
      const started = performance.now();
      let bytes = 0,
        count = 0;
      while (head < items.length && bytes < byteBudget && count < countBudget) {
        const item = items[head++];
        waiting.get(item.target)?.delete(item.url);
        item.target.acceptPage?.(item.url, item.array);
        bytes += item.array.byteLength;
        count++;
        if (performance.now() - started >= msBudget) break;
      }
      if (head >= items.length) {
        items.length = 0;
        head = 0;
      }
      return count;
    },
  };
}
