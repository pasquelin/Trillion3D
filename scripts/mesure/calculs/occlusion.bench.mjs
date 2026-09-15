// A3 et A4 : le partage des occulteurs et le test d'occlusion d'une coupe entière.
// Référence = le code d'avant, recopié tel quel (`splitOccluders`, `projectBoxToScreen`,
// `countUnoccluded`) ; optimisée = `splitOccludersInto` et `countUnoccluded` du paquet.
// Les deux côtés appellent le même `hizRejects` : la ligne A4 mesure la projection seule, le gain du
// choix de niveau de mip étant porté par la ligne A5 et compté une seule fois.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { HIZ_BOUNDS_VALUES, projectBoxInto } from '../../../packages/sdk-browser/hizCorners.ts';
import { hizOversized, createHizCounts } from '../../../packages/sdk-browser/hizCounts.ts';
import { hizRejects } from '../../../packages/sdk-browser/hizOcclusion.ts';
import { countUnoccluded } from '../../../packages/sdk-browser/hizUnoccluded.ts';
import { splitOccludersInto } from '../../../packages/sdk-browser/hizSplit.ts';
import { buildHizPyramid } from '../../../packages/sdk-browser/hizDepth.ts';
import { compare, depose, graine } from './banc.mjs';
import { boites, camera } from './scenes.mjs';

const viewProjScratch = new THREE.Matrix4();
const boundsScratch = new Float64Array(HIZ_BOUNDS_VALUES);
/** `hizProjection.ts:65-92` avant le lot A : un objet `HizBounds` alloué par boîte et par image. */
function referenceProjectBoxToScreen(min, max, world, cam, viewport) {
  cam.updateMatrixWorld();
  const viewProj = viewProjScratch.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  projectBoxInto(
    min,
    max,
    world,
    cam.matrixWorldInverse.elements,
    viewProj.elements,
    cam.near,
    viewport[0],
    viewport[1],
    boundsScratch,
    0,
  );
  const b = boundsScratch;
  if (b[5] !== 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0, nearestDepth: 0, clipsNear: true };
  return { minX: b[0], minY: b[1], maxX: b[2], maxY: b[3], nearestDepth: b[4], clipsNear: false };
}

/** `hizSplit.ts:70-91` avant le lot A : `.map` d'objets, `.sort` par comparateur, deux `.filter`. */
function referenceSplitOccluders(pages, cam, viewport) {
  const ranked = pages.map((page, index) => {
    const bounds = referenceProjectBoxToScreen(page.min, page.max, page.matrix, cam, viewport);
    return { page, index, nearest: bounds.nearestDepth, clipsNear: bounds.clipsNear };
  });
  ranked.sort((a, b) => a.nearest - b.nearest || a.index - b.index);
  const inFront = ranked.filter((item) => !item.clipsNear),
    crossing = ranked.filter((item) => item.clipsNear);
  if (!inFront.length) return { occluders: [], rest: pages };
  const mid = Math.max(1, Math.floor(inFront.length / 2));
  return {
    occluders: inFront.slice(0, mid).map((item) => item.page),
    rest: [...inFront.slice(mid), ...crossing].map((item) => item.page),
  };
}

/** `hizOcclusion.ts:152-178` avant le lot A : projection non cachée, allocation par page. */
function referenceCountUnoccluded(pages, pyramid, cam, viewport, counts, bias = 0) {
  const kept = [];
  for (const page of pages) {
    const bounds = referenceProjectBoxToScreen(page.min, page.max, page.matrix, cam, viewport);
    const triangles = page.array ? Math.floor(page.array.length / 3) : 0;
    counts.tested++;
    counts.testedTriangles += triangles;
    if (hizOversized(bounds.minX, bounds.minY, bounds.maxX, bounds.maxY, bounds.clipsNear)) {
      counts.oversized++;
      counts.oversizedTriangles += triangles;
    }
    if (hizRejects(pyramid, bounds, bias)) {
      counts.rejected++;
      counts.rejectedTriangles += triangles;
      continue;
    }
    kept.push(page);
  }
  return kept;
}

const LARGEUR = 640,
  HAUTEUR = 360;
const alea = graine(29),
  profondeur = new Float32Array(LARGEUR * HAUTEUR);
for (let i = 0; i < profondeur.length; i++) profondeur[i] = alea() * 0.4 + 0.5;
const pyramide = buildHizPyramid(profondeur, LARGEUR, HAUTEUR);
const cam = camera(6, 0.1, LARGEUR / HAUTEUR),
  viewport = [LARGEUR, HAUTEUR];
const grande = boites({ count: 20000 }),
  cas = (pages, nom) => ({ nom, entree: pages, taille: pages.length });
const jeux = [
  cas(grande, '20 000 boîtes dont dégénérées'),
  cas(grande.slice(0, 1), 'une boîte'),
  cas([], 'aucune boîte'),
  cas(grande.filter((_, i) => i % 311 === 0).slice(0, 64), 'que des coupes du plan proche'),
];

const urls = (pages) => pages.map((page) => page.url);
const occluders = [],
  rest = [];
const lignes = [
  await compare({
    calcul: 'A3 splitOccluders',
    fichier: 'packages/sdk-browser/hizSplit.ts',
    cas: jeux,
    reference: (pages) => {
      const split = referenceSplitOccluders(pages, cam, viewport);
      return { occluders: urls(split.occluders), rest: urls(split.rest) };
    },
    optimisee: (pages) => {
      splitOccludersInto(pages, cam, viewport, occluders, rest);
      return { occluders: urls(occluders), rest: urls(rest) };
    },
    options: { tours: 200, budgetMs: 2000 },
  }),
  await compare({
    calcul: 'A4 countUnoccluded',
    fichier: 'packages/sdk-browser/hizUnoccluded.ts',
    cas: jeux,
    reference: (pages) => {
      const counts = createHizCounts();
      return {
        kept: urls(referenceCountUnoccluded(pages, pyramide, cam, viewport, counts)),
        counts,
      };
    },
    optimisee: (pages) => {
      const counts = createHizCounts();
      return { kept: urls(countUnoccluded(pages, pyramide, cam, viewport, counts)), counts };
    },
    options: { tours: 200, budgetMs: 2000 },
  }),
];

test('A3 et A4 rendent exactement les mêmes pages et les mêmes comptes', () => {
  for (const ligne of lignes)
    assert.equal(ligne.difference, null, `${ligne.calcul} : ${ligne.difference}`);
});
depose('occlusion', lignes);
