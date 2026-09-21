// transfer admission and draining arrivals.
import { findAdmissible } from '../streamingQueueOrder.ts';
import { sortStreamJobs } from '../streamingQueueOrderFixture.ts';
import { createArrivalQueue } from '../arrivalQueue.ts';
import { graine, mesure, stress, rapport } from '../../sdk-core/bench/socle.ts';
import { referenceAdmission, referenceArrivalQueue } from './oracles/admission-arrivees.ts';

/** The fields `findAdmissible`/`sortStreamJobs` read: a lighter shape than the engine's `Job`. */
interface TravailAdmission {
  url: string;
  priority: number;
  order: number;
  consumers: number;
}

const LIMITE = 6,
  BUDGET_TRANSFERT = 2 * 1024 * 1024;
function optimiseeAdmission(
  queue: TravailAdmission[],
  octetsDe: (url: string) => number | undefined,
) {
  const admis: string[] = [];
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
const catalogue = new Map<string, number>();
const travaux: TravailAdmission[] = [];
for (let i = 0; i < 5000; i++) {
  const url = `page-${i % 4200}.bin`;
  catalogue.set(url, Math.floor(alea() * 400 * 1024));
  travaux.push({ url, priority: (i * 7) % 5, order: i, consumers: i % 97 ? 1 : 0 });
}
const octetsDe = (url: string) => catalogue.get(url);
const admission =
  (fn: (queue: TravailAdmission[], octetsDe: (url: string) => number | undefined) => string[]) =>
  (jeu: TravailAdmission[]) =>
    fn(jeu.slice(), octetsDe);

/** What `createArrivalQueue`/`referenceArrivalQueue` both build: `queue`/`drain` on the same shape. */
interface FabriqueFile {
  queue(
    target: { acceptPage(url: string, array: Uint32Array): void },
    url: string,
    array: Uint32Array,
  ): unknown;
  drain(): number;
}

function arrivees(fabrique: (byteBudget: number, countBudget: number) => FabriqueFile) {
  const livrees: string[] = [];
  const cibles: { acceptPage(url: string): void }[] = [];
  for (let c = 0; c < 8; c++)
    cibles.push({
      acceptPage: (url: string) => livrees.push(`${c}:${url}`),
    });
  const file = fabrique(64 * 1024 * 1024, 4096);
  const octets = new Uint32Array(16);
  for (let i = 0; i < 5000; i++) file.queue(cibles[i % 8], `page-${i % 900}.bin`, octets);
  let livrs = 0;
  for (let d = 0; d < 4; d++) livrs += file.drain();
  return { livrees, livrs };
}

const resAdmission = await mesure({
  name: 'admission streaming',
  fichier: 'packages/sdk-browser/streamingQueueOrder.ts',
  cas: [
    { name: '5 000 ordered jobs', input: travaux, size: 5000 },
    { name: 'no jobs', input: [], size: 0 },
  ],
  calcul: admission(optimiseeAdmission),
  attendu: admission(referenceAdmission),
  options: { tours: 100, budgetMs: 1500 },
});

const resArrivees = await mesure({
  name: 'arrival queue',
  fichier: 'packages/sdk-browser/arrivalQueue.ts',
  cas: [{ name: '5 000 arrivals on 8 targets', input: null, size: 5000 }],
  calcul: () => arrivees(createArrivalQueue),
  attendu: () => arrivees(referenceArrivalQueue),
  options: { tours: 60, budgetMs: 1500 },
});

await stress({
  name: 'createArrivalQueue extremes',
  calcul: (size: number) => createArrivalQueue(size, 4096),
  extremes: [
    { name: 'small', input: 4096 },
    { name: 'large', input: 1 << 28 },
  ],
});

rapport(
  'admission-arrivees',
  [resAdmission, resArrivees],
  'A12 admits and delivers the exact same pages',
);
