// A6 et A7 : le test d'une boîte contre le tronc, et les ensembles d'urls d'une image de résidence.
// Référence = `pageSelectionMath.ts:110-134`, `pageSelectionRequests.ts:77-96` et
// `autonomousResidency.ts:24-37` d'avant le lot A, recopiés dans `oracles/selection.mjs`.
import * as THREE from 'three';
import { boxClip, extractPlanes } from '../../../packages/sdk-browser/pageSelectionMath.ts';
import { collectPendingUrls } from '../../../packages/sdk-browser/pageSelectionRequests.ts';
import { createAutonomousResidency } from '../../../packages/sdk-browser/autonomousResidency.ts';
import { compare, graine, verifieEtDepose } from './banc.mjs';
import { boites, camera } from './scenes.mjs';
import {
  referenceBoxClip,
  referenceCollectPendingUrls,
  referenceResidency,
} from './oracles/selection.mjs';

const cam = camera(6, 0.1, 16 / 9);
const clip = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
const planes = new Float64Array(24);
extractPlanes(clip, planes);
const boxes = (liste) => {
  const plat = new Float64Array(liste.length * 6);
  for (let i = 0; i < liste.length; i++) {
    plat.set(liste[i].min, i * 6);
    plat.set(liste[i].max, i * 6 + 3);
  }
  return plat;
};
const grande = boxes(boites({ count: 20000 })),
  vide = new Float64Array(0);
const clipper = (fn) => (plat) => {
  const verdicts = new Uint8Array(plat.length / 6);
  for (let i = 0; i < verdicts.length; i++) {
    const b = i * 6;
    verdicts[i] = fn(
      planes,
      plat[b],
      plat[b + 1],
      plat[b + 2],
      plat[b + 3],
      plat[b + 4],
      plat[b + 5],
    );
  }
  return verdicts;
};

const alea = graine(41);
/** Un hôte : ses pages, ses urls de démarrage, ses pages modifiées, et les deux implémentations
 *  de résidence attachées à cet hôte — ce sont elles qui gardent leurs ensembles d'une image à
 *  l'autre, donc elles sont construites une fois, hors chronomètre. */
function hote(nombre) {
  const pages = [];
  for (let i = 0; i < nombre; i++)
    pages.push({
      url: `page-${i % Math.max(1, Math.floor(nombre * 0.6))}.bin`,
      streamUrl: i % 5 ? undefined : `bundle-${i % 400}.bin`,
      array: i % 3 ? undefined : new Uint32Array(3),
      seen: alea(),
    });
  const commun = {
    bootstrapUrls: new Set(pages.slice(0, Math.min(200, nombre)).map((rec) => rec.url)),
    modifiedPages: new Set(pages.slice(200, 260).map((rec) => rec.url)),
    shown: pages.slice(0, Math.floor(nombre * 0.4)),
    desired: pages,
  };
  const attendu = referenceResidency({ ...commun, pending: [], retained: [] });
  const obtenu = createAutonomousResidency({
    ...commun,
    pending: [],
    retained: [],
    byUrl: new Map(),
    geometryStore: { detach: () => {}, state: { allocationBytes: 0 } },
  });
  return { pages, attendu, obtenu, versReference: [], versOptimisee: [] };
}
const grandHote = hote(15000),
  hoteVide = hote(0);
/** Une image de résidence : les pages à demander, les urls retenues, les urls en attente. */
const imageDeResidence = (api, collect, into) => (h) => ({
  pending: [...api(h).pendingUrls()],
  retained: [...api(h).pageUrls()],
  attente: collect(h.pages, into(h)).slice(),
});

const lignes = [
  await compare({
    calcul: 'A6 boxClip',
    fichier: 'packages/sdk-browser/pageSelectionMath.ts',
    cas: [
      { nom: '20 000 boîtes dont dégénérées', entree: grande, taille: 20000 },
      { nom: 'aucune boîte', entree: vide, taille: 0 },
    ],
    reference: clipper(referenceBoxClip),
    optimisee: clipper(boxClip),
    options: { tours: 200, budgetMs: 2000 },
  }),
  await compare({
    calcul: 'A7 urls de résidence',
    fichier: 'packages/sdk-browser/autonomousResidency.ts',
    cas: [
      { nom: '15 000 pages, 9 000 urls, 400 paquets', entree: grandHote, taille: 15000 },
      { nom: 'aucune page', entree: hoteVide, taille: 0 },
    ],
    reference: imageDeResidence(
      (h) => h.attendu,
      referenceCollectPendingUrls,
      (h) => h.versReference,
    ),
    optimisee: imageDeResidence(
      (h) => h.obtenu,
      collectPendingUrls,
      (h) => h.versOptimisee,
    ),
    options: { tours: 60, budgetMs: 2000 },
  }),
];

verifieEtDepose(
  'selection',
  'A6 et A7 rendent exactement les mêmes verdicts et les mêmes urls',
  lignes,
);
