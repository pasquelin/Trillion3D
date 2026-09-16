// A12 : l'admission des transferts et le drain des arrivées.
// Référence = `streamingQueue.ts:22-59` et `arrivalQueue.ts:15-65` d'avant le lot A.
import { findAdmissible, sortStreamJobs } from '../streamingQueue.ts';
import { createArrivalQueue } from '../arrivalQueue.ts';
import { compare, graine, verifieEtDepose } from '../../sdk-core/bench/banc.mjs';
import { referenceAdmission, referenceArrivalQueue } from './oracles/streaming.mjs';

const LIMITE = 6,
  BUDGET_TRANSFERT = 2 * 1024 * 1024;
function optimiseeAdmission(queue, octetsDe) {
  const admis = [];
  let active = 0,
    activeBytes = 0,
    triee = false;
  while (active < LIMITE && queue.length) {
    if (!triee) {
      sortStreamJobs(queue);
      triee = true;
    }
    const at = findAdmissible(queue, active, activeBytes, octetsDe, BUDGET_TRANSFERT);
    if (at < 0) break;
    const job = queue.splice(at, 1)[0];
    if (job.consumers === 0) continue;
    active++;
    activeBytes += octetsDe(job.url) ?? 0;
    admis.push(job.url);
  }
  return admis;
}

const alea = graine(71);
const catalogue = new Map();
const travaux = [];
for (let i = 0; i < 5000; i++) {
  const url = `page-${i % 4200}.bin`;
  catalogue.set(url, Math.floor(alea() * 400 * 1024));
  travaux.push({ url, priority: (i * 7) % 5, order: i, consumers: i % 97 ? 1 : 0 });
}
const octetsDe = (url) => catalogue.get(url);
const admission = (fn) => (jeu) => fn(jeu.slice(), octetsDe);

/** Cinq mille arrivées pour huit destinataires, avec doublons : une page déjà en attente n'entre
 *  pas deux fois, une page déjà livrée peut revenir. */
function arrivees(fabrique) {
  const livrees = [];
  const cibles = [];
  for (let c = 0; c < 8; c++)
    cibles.push({
      acceptPage: (url) => livrees.push(`${c}:${url}`),
    });
  const file = fabrique(64 * 1024 * 1024, 4096);
  const octets = new Uint32Array(16);
  for (let i = 0; i < 5000; i++) file.queue(cibles[i % 8], `page-${i % 900}.bin`, octets);
  let livrs = 0;
  for (let d = 0; d < 4; d++) livrs += file.drain();
  return { livrees, livrs };
}

const lignes = [
  await compare({
    calcul: 'A12 admission et drain',
    fichier: 'packages/sdk-browser/streamingQueue.ts',
    cas: [
      { nom: '5 000 travaux en file, limite 6', entree: travaux, taille: travaux.length },
      { nom: 'file vide', entree: [], taille: 0 },
    ],
    reference: (jeu) => ({
      admis: admission(referenceAdmission)(jeu),
      arrivees: jeu.length ? arrivees(referenceArrivalQueue) : null,
    }),
    optimisee: (jeu) => ({
      admis: admission(optimiseeAdmission)(jeu),
      arrivees: jeu.length ? arrivees(createArrivalQueue) : null,
    }),
    options: { tours: 200, budgetMs: 2000 },
  }),
];

verifieEtDepose('streaming', 'A12 admet et livre exactement dans le même ordre', lignes);
