// Mesure absolue de la sélection : frustum clip et résidence autonome. Aucun oracle ici : ces deux
// calculs n'ont pas d'implémentation d'avant à confronter, leur justesse est tenue par
// `mathFrustumBox.test.ts` et `autonomousResidency.test.ts`. Chaque ligne le dit plutôt que de le taire.
import * as THREE from 'three';
import { clipPlanesFromMatrix, frustumClipBox } from '../../sdk-core/index.ts';
import { collectPendingUrls } from '../pageSelectionRequests.ts';
import { createAutonomousResidency } from '../autonomousResidency.ts';
import { graine, mesure, rapport, stress } from '../../sdk-core/bench/socle.mjs';
import { boites, camera } from './appui/scenes.mjs';

const cam = camera(6, 0.1, 16 / 9);
const clip = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
const planes = new Float64Array(24);
clipPlanesFromMatrix(planes, clip.elements);

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

const clipper = (plat) => {
  const verdicts = new Uint8Array(plat.length / 6);
  for (let i = 0; i < verdicts.length; i++) {
    const b = i * 6;
    verdicts[i] = frustumClipBox(
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

// ── Mesure frustumClipBox ────────────────────────────────────────────
const clipResult = await mesure({
  nom: 'frustumClipBox',
  fichier: 'packages/sdk-core/mathFrustumBox.ts',
  cas: [
    { nom: '20k boîtes dont dégénérées', entree: grande, taille: 20000 },
    { nom: 'aucune boîte', entree: vide, taille: 0 },
  ],
  calcul: clipper,
  motif: 'temps seul — justesse dans mathFrustumBox.test.ts',
  options: { tours: 200, budgetMs: 1000 },
});

// ── Mesure résidence ─────────────────────────────────────────────────
const alea = graine(41);
function hote(nombre) {
  const pages = [];
  for (let i = 0; i < nombre; i++)
    pages.push({
      url: `page-${i % Math.max(1, Math.floor(nombre * 0.6))}.bin`,
      streamUrl: i % 5 ? undefined : `bundle-${i % 400}.bin`,
      array: i % 3 ? undefined : new Uint32Array(3),
      seen: alea(),
    });
  const obtenu = createAutonomousResidency({
    bootstrapUrls: new Set(pages.slice(0, Math.min(200, nombre)).map((r) => r.url)),
    modifiedPages: new Set(pages.slice(200, 260).map((r) => r.url)),
    shown: pages.slice(0, Math.floor(nombre * 0.4)),
    desired: pages,
    pending: [],
    retained: [],
    byUrl: new Map(),
    geometryStore: { detach: () => {}, state: { allocationBytes: 0 } },
  });
  return { pages, obtenu, vers: [] };
}
const grandHote = hote(15000),
  hoteVide = hote(0);

const residenceResult = await mesure({
  nom: 'collectPendingUrls',
  fichier: 'packages/sdk-browser/pageSelectionRequests.ts',
  cas: [
    { nom: '15k pages', entree: grandHote, taille: 15000 },
    { nom: 'aucune page', entree: hoteVide, taille: 0 },
  ],
  calcul: (h) => ({
    pending: [...h.obtenu.pendingUrls()],
    retained: [...h.obtenu.pageUrls()],
    attente: collectPendingUrls(h.pages, h.vers).slice(),
  }),
  motif: 'temps seul — justesse dans autonomousResidency.test.ts',
  options: { tours: 60, budgetMs: 1000 },
});

// ── Stress testing ───────────────────────────────────────────────────
await stress({
  nom: 'frustumClipBox extremes',
  calcul: (e) => frustumClipBox(planes, e[0], e[1], e[2], e[3], e[4], e[5]),
  extremes: [
    { nom: 'boîte NaN', entree: [NaN, NaN, NaN, NaN, NaN, NaN] },
    {
      nom: 'boîte Infinity',
      entree: [-Infinity, -Infinity, -Infinity, Infinity, Infinity, Infinity],
    },
    { nom: 'boîte inversée', entree: [1, 1, 1, -1, -1, -1] },
    { nom: 'boîte zéro', entree: [0, 0, 0, 0, 0, 0] },
    { nom: 'boîte -0', entree: [-0, -0, -0, -0, -0, -0] },
  ],
});

rapport(
  'tronc-residence',
  [clipResult, residenceResult],
  'Sélection : frustum clip et résidence — mesure absolue',
);
