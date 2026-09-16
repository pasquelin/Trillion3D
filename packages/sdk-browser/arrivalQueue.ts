/**
 * File d'arrivées de pages d'index : ce qui arrive du cache ou du réseau n'entre plus dans l'image
 * qui l'a découvert. Chaque arrivée est empilée, PLANIFIÉE hors du fil principal, puis un drain
 * unique et borné, en tête de l'image suivante, la fait résider avant la sélection. Une image ne
 * porte donc jamais plus que ce budget d'intégration, et la rafale d'un lot entier ne tombe plus au
 * milieu d'un `renderer.render`. L'ordre d'arrivée est conservé : un drain reprend exactement là où
 * le précédent s'est arrêté, et l'ordre dans lequel l'image a nommé ses pages manquantes est déjà
 * celui de sa priorité — le plus coûteux à manquer d'abord.
 *
 * Le plan est ce que le fil principal ne calcule plus : pour chaque enregistrement du paquet, son
 * premier mot et son nombre de mots, et les rangs de page que l'arrivée remue, triés. Il part dès
 * l'empilement et revient avant le drain ; le destinataire n'a plus qu'à poser des vues et à écrire.
 * Aucun octet de page ne voyage pour cela — seulement la fiche d'entiers du catalogue. Quand il n'y
 * a rien à faire planifier, ou pas de fil pour le faire, le plan est là dès l'empilement : l'arrivée
 * est alors livrable dans le même tour, et aucune attente ne s'ajoute à ce que le lot a remplacé.
 *
 * Le plafond qui compte est celui du TEMPS. Une arrivée porte un paquet de streaming dont le nombre
 * de clusters n'est pas connu d'avance : ni les octets d'index, ni le nombre de pages ne bornent
 * donc la durée qu'elle coûte. Le drain relit l'horloge après chaque livraison et rend la main dès
 * le plafond atteint ; le reste attend l'image suivante. Une livraison au moins passe toujours, sans
 * quoi une page plus longue à intégrer que le plafond n'entrerait jamais.
 */
import { planArrival, planArrivalHere, type ArrivalPlan } from './pageIntegrationHost.ts';

/** Ce que la file exige d'un destinataire : de quoi recevoir une page avant le prochain rendu, et
 *  la fiche du catalogue pour la requête — les entiers dont le plan se déduit, et rien d'autre. */
export type ArrivalTarget = {
  acceptPage?(url: string, array: Uint32Array, plan?: ArrivalPlan): void;
  pageSpecs?(url: string): Int32Array | undefined;
};

type Arrival = {
  target: ArrivalTarget;
  url: string;
  array: Uint32Array;
  plan: ArrivalPlan | undefined;
  ready: boolean;
  done: boolean;
  waits: number;
};

/**
 * Drains qu'une arrivée peut passer en tête de file sans que son plan soit revenu. Au-delà, l'image
 * ne l'attend plus : le plan se refait en ligne, sur le fil principal, plutôt que de laisser un
 * transport lent creuser un trou dans l'image. Deux images, pas une : un aller-retour de message
 * tient largement dans le temps qui sépare l'arrivée du drain suivant.
 */
const MAX_PLAN_WAITS = 2;

export function createArrivalQueue(byteBudget: number, countBudget: number, msBudget = 2) {
  const items: Arrival[] = [];
  // Une même page peut être vue par le cache puis par la fin de son téléchargement : tant qu'elle
  // attend, elle ne s'empile qu'une fois par destinataire. L'attente est oubliée dès la livraison.
  const waiting = new Map<ArrivalTarget, Set<string>>();
  let head = 0;
  /** Livre une arrivée avec son plan, et retire son adresse des pages en attente. */
  const deliver = (item: Arrival) => {
    item.done = true;
    waiting.get(item.target)?.delete(item.url);
    item.target.acceptPage?.(item.url, item.array, item.plan);
  };
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
      const item: Arrival = {
        target,
        url,
        array,
        plan: undefined,
        ready: false,
        done: false,
        waits: 0,
      };
      items.push(item);
      const planned = planArrival(url, array.length, target.pageSpecs?.(url));
      // Un plan déjà là — rien à planifier, ou pas de file hors fil — n'est pas une attente : il
      // rend l'arrivée livrable dès son empilement. Seul un message réellement parti fait attendre.
      if (planned instanceof Promise)
        void planned.then((plan) => {
          // Une arrivée déjà livrée — l'image a cessé de l'attendre — ignore son plan tardif.
          if (item.done) return;
          item.plan = plan;
          item.ready = true;
        });
      else {
        item.plan = planned;
        item.ready = true;
      }
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
        const item = items[head];
        if (!item.ready) {
          // L'ordre est la priorité : une arrivée dont le plan n'est pas revenu retient celles qui
          // la suivent, le temps de deux drains, puis se fait planifier en ligne et passe.
          if (item.waits++ < MAX_PLAN_WAITS) break;
          // Même fonction, même résultat, sur le fil principal : le repli du contrat est synchrone.
          item.plan = planArrivalHere(
            item.url,
            item.array.length,
            item.target.pageSpecs?.(item.url),
          );
        }
        head++;
        deliver(item);
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
