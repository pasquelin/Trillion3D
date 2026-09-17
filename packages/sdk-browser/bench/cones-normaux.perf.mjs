// F18 : préparation des cônes normaux et catalogue de pages.
import * as THREE from 'three';
import { prepareCones } from '../webgpuPagesPrepare.ts';
import { compteMateriauxEtTangentes, indexSourceBytes } from '../webgpuPagesCatalogue.ts';
import { graine, mesure, stress, rapport } from '../../sdk-core/bench/mesure.mjs';
import {
  entreeCones,
  referenceCompteMateriauxEtTangentes,
  referenceIndexSourceBytes,
  referencePrepareCones,
} from './oracles/cones-normaux.mjs';
import { catalogueDePages } from './scenesChargement.mjs';

const alea = graine(6151);
const pages = catalogueDePages({ pages: 20000, materiaux: 60 });
const unePage = catalogueDePages({ pages: 1, materiaux: 1, seed: 17 });
const hostiles = catalogueDePages({ pages: 400, materiaux: 8, seed: 23 }).map((rec, i) => {
  if (i % 5 === 0) return { ...rec, array: undefined };
  if (i % 7 === 0) return { ...rec, attributes: {} };
  if (i % 11 === 0) {
    const brut = new Float32Array(192 * 4);
    for (let k = 0; k < brut.length; k++) brut[k] = alea() * 4 - 2;
    const tampon = new THREE.InterleavedBuffer(brut, 4);
    return { ...rec, attributes: { position: new THREE.InterleavedBufferAttribute(tampon, 3, 0) } };
  }
  if (i % 13 === 0) {
    const brut = new Int16Array(192 * 3);
    for (let k = 0; k < brut.length; k++) brut[k] = Math.floor(alea() * 65536) - 32768;
    return { ...rec, attributes: { position: new THREE.BufferAttribute(brut, 3, true) } };
  }
  return rec;
});

const passeCones = (fn) => (liste) => {
  const copies = liste.map((rec) => ({ ...rec, cone: undefined }));
  fn(entreeCones(copies));
  return copies.map((rec) => (rec.cone ? Float64Array.from(rec.cone) : null));
};

const blocs = new Map();
for (let i = 0; i < 4000; i++) blocs.set(`bloc/${i}`, { hasTangent: i % 3 === 0 });
const blocVide = new Map();

const casPages = [
  { nom: '20 000 pages, 60 matériaux', entree: pages, taille: 20000 },
  { nom: 'attributs entrelacés, normalisés, absents', entree: hostiles, taille: 400 },
  { nom: 'une seule page', entree: unePage, taille: 1 },
  { nom: 'aucune page', entree: [], taille: 0 },
];

const resCones = await mesure({
  nom: 'F18 cônes normaux des pages',
  fichier: 'packages/sdk-browser/webgpuPagesPrepare.ts',
  cas: casPages,
  calcul: passeCones(prepareCones),
  attendu: passeCones(referencePrepareCones),
  options: { tours: 40, budgetMs: 1500 },
});

const resDiagnostic = await mesure({
  nom: 'F18 compteurs du diagnostic des textures',
  fichier: 'packages/sdk-browser/webgpuPagesCatalogue.ts',
  cas: [
    { nom: '20 000 pages, 4 000 blocs', entree: { pages, blocs }, taille: 24000 },
    { nom: 'aucun bloc', entree: { pages: unePage, blocs: blocVide }, taille: 1 },
    { nom: 'rien à compter', entree: { pages: [], blocs: blocVide }, taille: 0 },
  ],
  calcul: (e) => compteMateriauxEtTangentes(e.pages, e.blocs),
  attendu: (e) => referenceCompteMateriauxEtTangentes(e.pages, e.blocs),
  options: { tours: 60, budgetMs: 1500 },
});

await stress({
  nom: 'prepareCones extremes',
  calcul: (c) => prepareCones(entreeCones(c)),
  extremes: [{ nom: 'vide', entree: [] }],
});

rapport('f-cones', [resCones, resDiagnostic], 'F18 calcule exactement les mêmes cônes et diagnostics');
