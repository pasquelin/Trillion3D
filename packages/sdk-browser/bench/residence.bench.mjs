// A8 et A11 : le comptage des pages résidentes, et ce que la sélection GPU relit par image.
// Référence = `autonomousPages.ts:168-182`, `gpuDagRuntime.ts:77-101` et `gpuDagUniforms.ts:31-52`
// d'avant le lot A, recopiés tels quels.
import { maxStretch } from '../../sdk-core/index.ts';
import { comptePagesResidentes } from '../autonomousResidency.ts';
import { updateResidencyBits } from '../gpuDagRuntime.ts';
import { parseDagOutput } from '../gpuDagUniforms.ts';
import { PAGE_CONE_FLOATS } from '../gpuSelection.ts';
import { residentBase, residentWords } from '../gpuDagLayout.ts';
import { compare, graine, verifieEtDepose } from '../../sdk-core/bench/banc.mjs';
import {
  referenceParseDagOutput,
  referenceUpdateResidency,
  residencyColumn,
} from './oracles/residence.mjs';

/** La largeur du cône vient du moteur : un banc qui la redéclare peut comparer à faux. Le rang du
 *  drapeau de résidence, lui, est écrit en clair dans le moteur (`gpuDagRuntime.ts`) ; le banc le
 *  recopie tel quel plutôt que d'inventer une relation entre les deux. */
const CONE_FLOATS = PAGE_CONE_FLOATS,
  FLAG = 11;

const alea = graine(53);
const PAGES = 20000;
const pages = [];
for (let i = 0; i < PAGES * 2; i++) pages.push({ array: i % 3 ? new Uint32Array(3) : undefined });

/** Huit images de résidence : une page sur quarante bascule d'une image à l'autre. */
const images = [];
for (let image = 0; image < 8; image++) {
  const next = new Uint32Array(PAGES);
  for (let j = 0; j < PAGES; j++) next[j] = (j + image) % 40 ? 1 : 0;
  images.push(next);
}
const conesNeufs = () => {
  const cones = new Float32Array(PAGES * CONE_FLOATS);
  for (let j = 0; j < PAGES * CONE_FLOATS; j++) cones[j] = alea();
  return cones;
};
const conesReference = conesNeufs();
/** Les bits de résidence de l'optimisée, un mot pour trente-deux pages, et les mots qu'elle touche. */
const base = residentBase(PAGES),
  bits = new Uint32Array(base + residentWords(PAGES)),
  motsTouches = new Int32Array(residentWords(PAGES));
for (let j = 0; j < PAGES; j++)
  if (conesReference[j * CONE_FLOATS + FLAG] >= 0.5) bits[base + (j >>> 5)] |= 1 << (j & 31);
const colonne = (cones) => {
  const sortie = new Float32Array(PAGES);
  for (let j = 0; j < PAGES; j++) sortie[j] = cones[j * CONE_FLOATS + FLAG];
  return sortie;
};

const mondes = new Float32Array(64 * 16);
for (let i = 0; i < mondes.length; i++) mondes[i] = i % 17 === 0 ? 1 + alea() : alea() * 0.01;

const sortieGpu = new Uint32Array(4 + 12000 + 20000);
sortieGpu[0] = 12000;
sortieGpu[1] = 431;
sortieGpu[2] = 5;
sortieGpu[3] = 0;
for (let i = 0; i < 12000; i++) sortieGpu[4 + i] = i * 3;
for (let i = 0; i < 20000; i++) sortieGpu[4 + 12000 + i] = i % 7 ? 1 : 0;

const cas = [
  { nom: '8 images, 20 000 pages', entree: { quoi: 'residence' }, taille: PAGES * 8 },
  { nom: 'lecture de coupe, 12 000 pages tirées', entree: { quoi: 'sortie' }, taille: 12000 },
  { nom: '64 mondes', entree: { quoi: 'etirement' }, taille: 64 },
  { nom: 'aucune page', entree: { quoi: 'vide' }, taille: 0 },
];
const passe = (residence, lecture, etirement) => (entree) => {
  if (entree.quoi === 'residence') return residence();
  if (entree.quoi === 'sortie') return lecture(20000);
  if (entree.quoi === 'etirement') return etirement();
  return lecture(0);
};

const lignes = [
  await compare({
    calcul: 'A8 pages résidentes',
    fichier: 'packages/sdk-browser/autonomousResidency.ts',
    cas: [
      { nom: '40 000 pages', entree: pages, taille: pages.length },
      { nom: 'aucune page', entree: [], taille: 0 },
    ],
    reference: (liste) => liste.filter((rec) => !!rec.array).length,
    optimisee: (liste) => comptePagesResidentes(liste),
    options: { tours: 200, budgetMs: 2000 },
  }),
  await compare({
    calcul: 'A11 résidence et lecture de coupe',
    fichier: 'packages/sdk-browser/gpuDagRuntime.ts',
    cas,
    reference: passe(
      () => ({
        drapeaux: images.map((next) => referenceUpdateResidency(next, conesReference)),
        colonne: colonne(conesReference).map((v) => (v >= 0.5 ? 1 : 0)),
      }),
      (masque) => referenceParseDagOutput(sortieGpu.buffer, 0, sortieGpu.byteLength, masque),
      () => {
        const etirements = new Float64Array(64);
        for (let w = 0; w < 64; w++)
          etirements[w] = maxStretch(Array.from(mondes.subarray(w * 16, w * 16 + 16)));
        return etirements;
      },
    ),
    optimisee: passe(
      () => ({
        drapeaux: images.map(
          (next) => updateResidencyBits(next, bits, base, undefined, motsTouches) > 0,
        ),
        colonne: residencyColumn(bits, base, PAGES),
      }),
      (masque) => parseDagOutput(sortieGpu.buffer, 0, sortieGpu.byteLength, masque),
      () => {
        const etirements = new Float64Array(64);
        for (let w = 0; w < 64; w++)
          etirements[w] = maxStretch(mondes.subarray(w * 16, w * 16 + 16));
        return etirements;
      },
    ),
    options: { tours: 200, budgetMs: 2000 },
  }),
];

verifieEtDepose(
  'residence',
  'A8 et A11 rendent exactement les mêmes comptes, drapeaux et coupes',
  lignes,
);
