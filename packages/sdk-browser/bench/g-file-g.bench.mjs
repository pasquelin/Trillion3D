// G5 et G6 : les deux recherches linéaires du chemin de streaming. G5 marque la demande abandonnée
// et compacte la file en un passage ; G6 confie l'appartenance de la file d'attente à un `Set`.
import { compacteFile } from '../streamingQueue.ts';
import { empileEnAttente } from '../explorerDraw.ts';
import { compare, graine } from '../../sdk-core/bench/banc.mjs';
import { verifieEtDeposeG } from '../../sdk-core/bench/bancG.mjs';
import { referenceEmpileEnAttente, referenceRetireDeLaFile } from './oracles/g-file.mjs';

/** Les adresses d'une file : `total` travaux, et les rangs que la rafale d'annulations vise. */
function rafale(total, annulations, depart) {
  const alea = graine(depart);
  const urls = [];
  for (let i = 0; i < total; i++) urls.push(`pages/${i}-${Math.floor(alea() * 1e6)}.bin`);
  const vises = [];
  for (let i = 0; i < annulations; i++) vises.push(Math.floor(alea() * Math.max(1, total)));
  return { urls, vises };
}

const file = ({ urls }) => urls.map((url) => ({ url, state: 'queued' }));

/** L'ancien chemin : un balayage puis un décalage par demande abandonnée. */
function passeReference({ urls, vises }) {
  const queue = file({ urls });
  const cibles = vises.map((rang) => queue[rang % Math.max(1, queue.length)]).filter(Boolean);
  for (const job of cibles) referenceRetireDeLaFile(queue, job);
  return queue.map((job) => job.url);
}

/** Le nouveau : la demande est marquée, la file compactée une seule fois au passage suivant. */
function passeOptimisee({ urls, vises }) {
  const queue = file({ urls });
  const cibles = vises.map((rang) => queue[rang % Math.max(1, queue.length)]).filter(Boolean);
  for (const job of cibles) job.state = 'dropped';
  compacteFile(queue);
  return queue.map((job) => job.url);
}

/** Adresses à empiler, avec des doublons et des chaînes hostiles voisines. */
function adresses(total, depart) {
  const alea = graine(depart);
  const sortie = [];
  for (let i = 0; i < total; i++)
    sortie.push(
      alea() < 0.3 && sortie.length ? sortie[Math.floor(alea() * sortie.length)] : `p/${i}.bin`,
    );
  return sortie;
}
const HOSTILES = ['', '-0', '0', 'NaN', 'Infinity', '', '-0', 'undefined', 'null', 'NaN'];

const lignes = [
  await compare({
    calcul: 'G5 retrait d’une demande annulée de la file',
    fichier: 'packages/sdk-browser/streamingQueue.ts',
    cas: [
      { nom: '4 000 travaux, 2 000 annulations', entree: rafale(4000, 2000, 0x51), taille: 4000 },
      { nom: '4 000 travaux, une annulation', entree: rafale(4000, 1, 0x52), taille: 4000 },
      {
        nom: 'un travail, deux annulations du même',
        entree: { urls: ['p/0.bin'], vises: [0, 0] },
        taille: 1,
      },
      { nom: 'file vide, aucune annulation', entree: { urls: [], vises: [] }, taille: 0 },
      { nom: 'file vide, une annulation hors file', entree: { urls: [], vises: [7] }, taille: 0 },
    ],
    reference: passeReference,
    optimisee: passeOptimisee,
    options: { tours: 200, budgetMs: 4000, alterne: true },
  }),
  await compare({
    calcul: 'G6 file d’attente des adresses manquantes',
    fichier: 'packages/sdk-browser/explorerDraw.ts',
    cas: [
      { nom: '2 000 adresses, 30 % de doublons', entree: adresses(2000, 0x61), taille: 2000 },
      { nom: 'chaînes hostiles répétées', entree: HOSTILES, taille: HOSTILES.length },
      { nom: 'une seule adresse', entree: ['p/0.bin'], taille: 1 },
      { nom: 'aucune adresse', entree: [], taille: 0 },
    ],
    reference: (urls) => {
      const attente = [];
      referenceEmpileEnAttente(attente, urls);
      return attente;
    },
    optimisee: (urls) => {
      const attente = new Set();
      empileEnAttente(attente, urls);
      return [...attente];
    },
    options: { tours: 200, budgetMs: 4000, alterne: true },
  }),
];

verifieEtDeposeG(
  'g-file',
  'G5 et G6 laissent exactement les mêmes adresses, dans le même ordre',
  lignes,
);
