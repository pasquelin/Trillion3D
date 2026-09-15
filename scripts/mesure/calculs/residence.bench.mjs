// A8 et A11 : le comptage des pages résidentes, et ce que la sélection GPU relit par image.
// Référence = `autonomousPages.ts:168-182`, `gpuDagRuntime.ts:77-101` et `gpuDagUniforms.ts:31-52`
// d'avant le lot A, recopiés tels quels.
import test from 'node:test';
import assert from 'node:assert/strict';
import { maxStretch } from '../../../packages/sdk-core/index.ts';
import { comptePagesResidentes } from '../../../packages/sdk-browser/autonomousResidency.ts';
import { updateResidencyFlags } from '../../../packages/sdk-browser/gpuDagRuntime.ts';
import { parseDagOutput } from '../../../packages/sdk-browser/gpuDagUniforms.ts';
import { compare, depose, graine } from './banc.mjs';

const CONE_FLOATS = 12,
  FLAG = 11;

/** `gpuDagRuntime.ts:94-101` avant le lot A : la colonne de résidence lue à travers les cônes. */
function referenceUpdateResidency(next, pageCones) {
  let changed = false;
  for (let j = 0; j < next.length; j++) {
    const index = j * CONE_FLOATS + FLAG,
      value = next[j] ? 1 : 0;
    if (pageCones[index] !== value) {
      pageCones[index] = value;
      changed = true;
    }
  }
  return changed;
}

/** `gpuDagUniforms.ts:31-52` avant le lot A : spread d'un tableau typé et `push` sans capacité. */
function referenceParseDagOutput(bytes, byteOffset, byteLength, maskPageCount) {
  const ints = new Uint32Array(bytes, byteOffset, Math.floor(byteLength / 4));
  if (((ints[3] ?? 0) & 1) !== 0) return null;
  const count = Math.min(ints[0] ?? 0, Math.max(0, ints.length - 4 - maskPageCount));
  const result = {
    pageIds: [...ints.subarray(4, 4 + count)],
    frustumRejected: ints[1] ?? 0,
    lodLevel: ints[2] ?? 0,
    complete: ((ints[3] ?? 0) & 2) === 0,
  };
  if (maskPageCount) {
    result.drawablePageIds = [];
    const offset = ints.length - maskPageCount;
    for (let i = 0; i < maskPageCount; i++) if (ints[offset + i]) result.drawablePageIds.push(i);
  }
  return result;
}

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
const conesReference = conesNeufs(),
  conesOptimisee = conesReference.slice(),
  miroir = new Float32Array(PAGES);
for (let j = 0; j < PAGES; j++) miroir[j] = conesOptimisee[j * CONE_FLOATS + FLAG];
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
        colonne: colonne(conesReference),
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
        drapeaux: images.map((next) =>
          updateResidencyFlags(next, miroir, conesOptimisee, CONE_FLOATS, FLAG),
        ),
        colonne: colonne(conesOptimisee),
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

test('A8 et A11 rendent exactement les mêmes comptes, drapeaux et coupes', () => {
  for (const ligne of lignes)
    assert.equal(ligne.difference, null, `${ligne.calcul} : ${ligne.difference}`);
});
depose('residence', lignes);
