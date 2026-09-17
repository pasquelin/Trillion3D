// les deux recherches linéaires du chemin de streaming.
import { compacteFile } from '../streamingQueueOrder.ts';
import { empileEnAttente } from '../explorerDraw.ts';
import { graine, mesure, stress, rapport } from '../../sdk-core/bench/socle.mjs';
import {
  referenceEmpileEnAttente,
  referenceRetireDeLaFile,
} from './oracles/recherches-streaming.mjs';

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
  const sortie = [];
  for (let i = 0; i < total; i++)
    sortie.push(
      alea() < 0.3 && sortie.length ? sortie[Math.floor(alea() * sortie.length)] : `p/${i}.bin`,
    );
  return sortie;
}

const resG5 = await mesure({
  nom: 'retrait demande annulée de file',
  fichier: 'packages/sdk-browser/streamingQueue.ts',
  cas: [
    { nom: '4 000 travaux, 2 000 annulations', entree: rafale(4000, 2000, 0x51), taille: 4000 },
    { nom: '4 000 travaux, une annulation', entree: rafale(4000, 1, 0x52), taille: 4000 },
  ],
  calcul: passeOptimisee,
  attendu: passeReference,
  options: { tours: 40, budgetMs: 1500 },
});

const urlsEmpilees = adresses(4000, 0x61);
const resG6 = await mesure({
  nom: 'empilement en attente',
  fichier: 'packages/sdk-browser/explorerDraw.ts',
  cas: [{ nom: '4 000 adresses à empiler', entree: urlsEmpilees, taille: 4000 }],
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
  nom: 'compacteFile extremes',
  calcul: (q) => compacteFile(q),
  extremes: [{ nom: 'vide', entree: [] }],
});

rapport(
  'recherches-streaming',
  [resG5, resG6],
  'G5 et G6 retirent et empilent exactement les mêmes adresses',
);
