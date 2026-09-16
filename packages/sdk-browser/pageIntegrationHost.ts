import { PAGE_INTEGRATION_PROTOCOL } from '../sdk-core/index.ts';
import { createPageIntegrationLane } from './pageIntegrationLane.ts';
import { createPageIntegrationRunner } from './pageIntegrationTask.ts';
import type { PageIntegrationAnswer } from '../sdk-core/index.ts';

/** Ce qu'une arrivée planifiée rend au fil principal : des entiers, déjà dans l'ordre de la fiche. */
export type ArrivalPlan = {
  url: string;
  slices: Int32Array;
  count: number;
  pages: Int32Array;
  pageCount: number;
};

const counters = { plans: 0, offThread: 0, planMs: 0 };
/** Le repli : la même tâche, la même fonction, exécutée sur le fil principal. */
const inline = createPageIntegrationRunner();
const inlineKnown = new Set<string>();
let lane: ReturnType<typeof createPageIntegrationLane> | undefined;
let laneKnown = new Set<string>();
/** `undefined` tant que l'épreuve de démarrage n'a pas répondu, puis son verdict. */
let started: boolean | undefined;

/**
 * La file d'intégration si son épreuve de démarrage a déjà réussi, `undefined` sinon. L'épreuve est
 * lancée mais **jamais attendue** : tant qu'elle n'a pas répondu, et pour toujours si elle ne répond
 * pas, le plan se fait sur le fil principal. Une arrivée ne dépend donc jamais du démarrage d'un
 * worker. Une file cassée après son démarrage ne revient pas.
 */
function openLane() {
  if (started === false) return undefined;
  if (!lane) {
    lane = createPageIntegrationLane();
    void lane.start().then((ok) => {
      started = ok;
      if (!ok) lane = undefined;
    });
  }
  if (started && !lane.alive) {
    started = false;
    return undefined;
  }
  return started ? lane : undefined;
}

const read = (answer: PageIntegrationAnswer, offThread: boolean): ArrivalPlan | undefined => {
  if (!answer.ok) return undefined;
  counters.plans++;
  counters.planMs += answer.taskMs;
  if (offThread) counters.offThread++;
  return {
    url: answer.url,
    slices: new Int32Array(answer.slices),
    count: answer.count,
    pages: new Int32Array(answer.pages),
    pageCount: answer.pageCount,
  };
};

/**
 * Le plan fait en ligne, avec la fiche que l'appelant tient : il n'échoue que si elle manque. C'est
 * le repli du contrat, et c'est aussi ce qu'appelle une image qui a cessé d'attendre son plan.
 */
export function planArrivalHere(url: string, words: number, specs: Int32Array | undefined) {
  const send = !inlineKnown.has(url);
  if (send && specs) inlineKnown.add(url);
  return read(
    inline.run({
      protocol: PAGE_INTEGRATION_PROTOCOL,
      id: 0,
      url,
      words,
      specs: send && specs ? (specs.slice().buffer as ArrayBuffer) : null,
    }),
    false,
  );
}

/**
 * Le plan d'intégration d'un paquet arrivé, calculé hors du fil principal quand la plateforme le
 * permet, et par la même fonction sur le fil principal sinon. Un seul chemin logique, deux
 * transports : le plan rendu est le même aux bits près, puisque c'est la même arithmétique
 * d'entiers dans le même ordre.
 *
 * Aucun octet de page ne voyage : la fiche d'une requête — offsets, triangles, rangs de page — ne
 * tient que des entiers du catalogue, et elle ne part qu'à la première arrivée de cette adresse.
 * Le tampon du cache reste donc intact chez son propriétaire, ni copié ni détaché.
 */
export async function planArrival(
  url: string,
  words: number,
  specs: Int32Array | undefined,
): Promise<ArrivalPlan | undefined> {
  const open = openLane();
  if (!open) return planArrivalHere(url, words, specs);
  const send = !laneKnown.has(url);
  if (send && specs) laneKnown.add(url);
  const answer = await open.submit(
    url,
    words,
    send && specs ? (specs.slice().buffer as ArrayBuffer) : null,
  );
  // Un worker disparu, ou un worker sans la fiche, ne perd rien : les octets sont restés chez leur
  // propriétaire, et le fil principal sait faire le même plan.
  if (!answer.ok) {
    if (!open.alive) laneKnown = new Set();
    else laneKnown.delete(url);
    return planArrivalHere(url, words, specs);
  }
  return read(answer, true);
}

/** Plans faits hors fil, temps cumulé des plans, présence d'un worker. `null` quand rien n'a été
 *  planifié : une métrique non mesurée n'est pas un zéro. */
export function pageIntegrationStats() {
  if (!counters.plans) return { plans: null, offThread: null, planMs: null, worker: null };
  return {
    plans: counters.plans,
    offThread: counters.offThread,
    planMs: counters.planMs,
    worker: lane?.alive === true,
  };
}

/** Ferme la file et remet les compteurs à leur état non mesuré. */
export function releasePageIntegration() {
  lane?.retire();
  lane = undefined;
  started = undefined;
  laneKnown = new Set();
  inlineKnown.clear();
  counters.plans = 0;
  counters.offThread = 0;
  counters.planMs = 0;
}
