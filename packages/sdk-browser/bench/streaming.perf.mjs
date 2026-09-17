// A12 : l'admission des transferts et le drain des arrivées.
import { findAdmissible } from '../streamingQueueOrder.ts';
import { sortStreamJobs } from '../streamingQueueOrderFixture.ts';
import { createArrivalQueue } from '../arrivalQueue.ts';
import { graine, mesure, stress, rapport } from '../../sdk-core/bench/mesure.mjs';
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

const resAdmission = await mesure({
  nom: 'A12 admission streaming',
  fichier: 'packages/sdk-browser/streamingQueueOrder.ts',
  cas: [
    { nom: '5 000 tâches ordonnées', entree: travaux, taille: 5000 },
    { nom: 'aucune tâche', entree: [], taille: 0 },
  ],
  calcul: admission(optimiseeAdmission),
  attendu: admission(referenceAdmission),
  options: { tours: 100, budgetMs: 1500 },
});

const resArrivees = await mesure({
  nom: 'A12 file des arrivées',
  fichier: 'packages/sdk-browser/arrivalQueue.ts',
  cas: [
    { nom: '5 000 arrivées sur 8 cibles', entree: null, taille: 5000 },
  ],
  calcul: () => arrivees(createArrivalQueue),
  attendu: () => arrivees(referenceArrivalQueue),
  options: { tours: 60, budgetMs: 1500 },
});

await stress({
  nom: 'createArrivalQueue extremes',
  calcul: (size) => createArrivalQueue(size, 4096),
  extremes: [
    { nom: 'petite', entree: 4096 },
    { nom: 'grande', entree: 1 << 28 },
  ],
});

rapport('streaming', [resAdmission, resArrivees], 'A12 admet et livre exactement les mêmes pages');
