// the two linear searches of the streaming path.
import { compacteFile } from '../streamingQueueOrder.ts';
import { empileEnAttente } from '../explorerDraw.ts';
import { graine, mesure, stress, rapport } from '../../sdk-core/bench/socle.ts';
import {
  referenceEmpileEnAttente,
  referenceRetireDeLaFile,
} from './oracles/recherches-streaming.ts';

function rafale(total, annulations, depart) {
  const alea = graine(depart);
  const urls = [];
  for (let i = 0; i < total; i++) urls.push(`pages/${i}-${Math.floor(alea() * 1e6)}.bin`);
  const vises = [];
  for (let i = 0; i < annulations; i++) vises.push(Math.floor(alea() * Math.max(1, total)));
  return { urls, vises };
}

const file = ({ urls }) => urls.map((url) => ({ url, state: 'queued' }));

function passeReference({ urls, vises }) {
  const queue = file({ urls });
  const cibles = vises.map((rang) => queue[rang % Math.max(1, queue.length)]).filter(Boolean);
  for (const job of cibles) referenceRetireDeLaFile(queue, job);
  return queue.map((job) => job.url);
}

function passeOptimisee({ urls, vises }) {
  const queue = file({ urls });
  const cibles = vises.map((rang) => queue[rang % Math.max(1, queue.length)]).filter(Boolean);
  for (const job of cibles) job.state = 'dropped';
  compacteFile(queue);
  return queue.map((job) => job.url);
}

function adresses(total, depart) {
  const alea = graine(depart);
  const output = [];
  for (let i = 0; i < total; i++)
    output.push(
      alea() < 0.3 && output.length ? output[Math.floor(alea() * output.length)] : `p/${i}.bin`,
    );
  return output;
}

const resG5 = await mesure({
  name: 'removing a cancelled request from the queue',
  fichier: 'packages/sdk-browser/streamingQueue.ts',
  cas: [
    { name: '4 000 jobs, 2 000 cancellations', input: rafale(4000, 2000, 0x51), size: 4000 },
    { name: '4 000 jobs, one cancellation', input: rafale(4000, 1, 0x52), size: 4000 },
  ],
  calcul: passeOptimisee,
  attendu: passeReference,
  options: { tours: 40, budgetMs: 1500 },
});

const urlsEmpilees = adresses(4000, 0x61);
const resG6 = await mesure({
  name: 'pending stack',
  fichier: 'packages/sdk-browser/explorerDraw.ts',
  cas: [{ name: '4 000 addresses to stack', input: urlsEmpilees, size: 4000 }],
  calcul: (urls) => {
    const arr = [];
    const set = new Set();
    empileEnAttente(urls, arr, set);
    return arr;
  },
  attendu: (urls) => {
    const arr = [];
    referenceEmpileEnAttente(urls, arr);
    return arr;
  },
  options: { tours: 100, budgetMs: 1500 },
});

await stress({
  name: 'compacteFile extremes',
  calcul: (q) => compacteFile(q),
  extremes: [{ name: 'empty', input: [] }],
});

rapport(
  'recherches-streaming',
  [resG5, resG6],
  'G5 and G6 remove and stack the exact same addresses',
);
