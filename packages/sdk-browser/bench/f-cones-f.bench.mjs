// F18 : ce que la préparation d'un moteur WebGPU recopiait au chargement. Les cônes lisent un
// attribut simple par bloc au lieu d'un accesseur par sommet, et le matériau d'une page une fois au
// lieu de deux. La table des octets source et les compteurs du diagnostic passent d'un `flatMap` ou
// d'un `map` complet à une boucle qui n'alloue que ce qu'elle rend.
import * as THREE from 'three';
import { prepareCones } from '../webgpuPagesPrepare.ts';
import { compteMateriauxEtTangentes, indexSourceBytes } from '../webgpuPagesCatalogue.ts';
import { compare, graine } from '../../sdk-core/bench/banc.mjs';
import { verifieEtDeposeF } from '../../sdk-core/bench/bancF.mjs';
import {
  referenceCompteMateriauxEtTangentes,
  referenceIndexSourceBytes,
  referencePrepareCones,
} from './oracles/f-cones.mjs';
import { catalogueDePages } from './scenesF.mjs';

const alea = graine(6151);
const pages = catalogueDePages({ pages: 20000, materiaux: 60 });
const unePage = catalogueDePages({ pages: 1, materiaux: 1, seed: 17 });
/** Pages hostiles : sans octets, sans attribut, attribut entrelacé, attribut normalisé, pas de 4. */
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
  fn({ setup: { allPages: copies } });
  return copies.map((rec) => (rec.cone ? Float64Array.from(rec.cone) : null));
};

/** Des blocs de géométrie, moitié avec tangentes : ce que le diagnostic compte au chargement. */
const blocs = new Map();
for (let i = 0; i < 4000; i++) blocs.set(`bloc/${i}`, { hasTangent: i % 3 === 0 });
const blocVide = new Map();

const casPages = [
  { nom: '20 000 pages, 60 matériaux', entree: pages, taille: 20000 },
  { nom: 'attributs entrelacés, normalisés, absents', entree: hostiles, taille: 400 },
  { nom: 'une seule page', entree: unePage, taille: 1 },
  { nom: 'aucune page', entree: [], taille: 0 },
];

const lignes = [
  await compare({
    calcul: 'F18 cônes normaux des pages',
    fichier: 'packages/sdk-browser/webgpuPagesPrepare.ts',
    cas: casPages,
    reference: passeCones(referencePrepareCones),
    optimisee: passeCones(prepareCones),
    options: { chauffe: 3, tours: 200, budgetMs: 4000 },
  }),
  await compare({
    calcul: 'F18 table des octets source',
    fichier: 'packages/sdk-browser/webgpuPagesCatalogue.ts',
    cas: casPages,
    reference: referenceIndexSourceBytes,
    optimisee: indexSourceBytes,
    options: { chauffe: 5, tours: 200, budgetMs: 3000 },
  }),
  await compare({
    calcul: 'F18 compteurs du diagnostic des textures',
    fichier: 'packages/sdk-browser/webgpuPagesCatalogue.ts',
    cas: [
      { nom: '20 000 pages, 4 000 blocs', entree: { pages, blocs }, taille: 24000 },
      { nom: 'aucun bloc', entree: { pages: unePage, blocs: blocVide }, taille: 1 },
      { nom: 'rien à compter', entree: { pages: [], blocs: blocVide }, taille: 0 },
    ],
    reference: (e) => referenceCompteMateriauxEtTangentes(e.pages, e.blocs),
    optimisee: (e) => compteMateriauxEtTangentes(e.pages, e.blocs),
    options: { chauffe: 5, tours: 200, budgetMs: 3000 },
  }),
];

verifieEtDeposeF(
  'f-cones',
  'F18 rend exactement les mêmes cônes, les mêmes octets et les mêmes comptes',
  lignes,
);
