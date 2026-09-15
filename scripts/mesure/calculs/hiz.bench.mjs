// A1 et A5 : la profondeur du visbuffer et le choix du niveau de mip.
// Référence = le code d'avant, recopié tel quel ; optimisée = celle du paquet.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { HIZ_BACKGROUND } from '../../../packages/sdk-core/index.ts';
import { HIZ_KERNEL_TEXELS } from '../../../packages/sdk-browser/hizCounts.ts';
import { hizTestRect } from '../../../packages/sdk-browser/hizOcclusion.ts';
import { visibilityDepth } from '../../../packages/sdk-browser/hizDepth.ts';
import { rasterVisibility } from '../../../packages/sdk-browser/visibilityRaster.ts';
import { projectVisibilityVertex } from '../../../packages/sdk-browser/visibilityProjection.ts';
import { unpackVisibilityId } from '../../../packages/sdk-browser/visibilityTypes.ts';
import { compare, depose } from './banc.mjs';
import { camera, coupe, rectangles } from './scenes.mjs';

const viewProjScratch = new THREE.Matrix4();
/** `hizDepth.ts:25-84` avant le lot A : trois projections par pixel. */
function referenceVisibilityDepth(ids, pages, cam, viewport) {
  const [width, height] = viewport,
    depth = new Float32Array(width * height);
  depth.fill(HIZ_BACKGROUND);
  cam.updateMatrixWorld();
  const viewProj = viewProjScratch.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const unpacked = unpackVisibilityId(ids[y * width + x]);
      if (!unpacked) continue;
      const page = pages[unpacked.pageIndex];
      if (!page?.attributes.position) continue;
      const index = page.array,
        base = unpacked.triangleIndex * 3;
      if (base + 2 >= index.length) continue;
      const p = page.attributes.position;
      const a = projectVisibilityVertex(page.matrix, p, index[base], viewProj, width, height);
      const b = projectVisibilityVertex(page.matrix, p, index[base + 1], viewProj, width, height);
      const c = projectVisibilityVertex(page.matrix, p, index[base + 2], viewProj, width, height);
      if (!a || !b || !c) continue;
      const area = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
      if (area === 0) continue;
      const w0 = ((b.x - x) * (c.y - y) - (c.x - x) * (b.y - y)) / area,
        w1 = ((c.x - x) * (a.y - y) - (a.x - x) * (c.y - y)) / area,
        w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const z = w0 * a.z + w1 * b.z + w2 * c.z;
      if (!Number.isFinite(z)) continue;
      depth[y * width + x] = z;
    }
  return depth;
}

/** `hizOcclusion.ts:37-81` avant le lot A : recherche linéaire du niveau, du mip 0 au dernier. */
function referenceHizTestRect(minX, minY, maxX, maxY, clipsNear, width, height, levels, into) {
  if (
    clipsNear ||
    !Number.isInteger(minX) ||
    !Number.isInteger(minY) ||
    !Number.isInteger(maxX) ||
    !Number.isInteger(maxY) ||
    maxX < minX ||
    maxY < minY ||
    width < 1 ||
    height < 1 ||
    levels < 1
  )
    return false;
  const x0 = minX < 0 ? 0 : minX,
    y0 = minY < 0 ? 0 : minY,
    x1 = maxX > width - 1 ? width - 1 : maxX,
    y1 = maxY > height - 1 ? height - 1 : maxY;
  if (x1 < x0 || y1 < y0) return false;
  for (let level = 0; level < levels; level++) {
    const scale = 2 ** level;
    if (
      Math.floor(x1 / scale) - Math.floor(x0 / scale) < HIZ_KERNEL_TEXELS &&
      Math.floor(y1 / scale) - Math.floor(y0 / scale) < HIZ_KERNEL_TEXELS
    ) {
      into[0] = level;
      into[1] = x0;
      into[2] = y0;
      into[3] = x1;
      into[4] = y1;
      return true;
    }
  }
  return false;
}

const image = (largeur, hauteur, pages) => {
  const cam = camera(6, 0.1, largeur / hauteur),
    viewport = [largeur, hauteur];
  return { ids: rasterVisibility(pages, cam, viewport).ids, pages, cam, viewport };
};
const pages = coupe({ pages: 900, triangles: 48 });
const profondeur = [
  { nom: '320×180, 43 200 triangles', entree: image(320, 180, pages), taille: 320 * 180 },
  {
    nom: '1280×720, 43 200 triangles',
    entree: image(1280, 720, pages),
    taille: 1280 * 720,
    mesure: false,
  },
  { nom: 'aucune page', entree: image(64, 36, []), taille: 64 * 36 },
  { nom: 'une page', entree: image(64, 36, pages.slice(0, 1)), taille: 64 * 36 },
];

const rects = rectangles({ count: 20000 });
const scratchReference = new Int32Array(5),
  scratchOptimisee = new Int32Array(5);
const parcours = (testRect, scratch) => (rectangles_) => {
  const sortie = new Int32Array(rectangles_.length * 6);
  for (let i = 0; i < rectangles_.length; i++) {
    const [x0, y0, x1, y1, clipsNear] = rectangles_[i];
    sortie[i * 6] = testRect(x0, y0, x1, y1, clipsNear, 1280, 720, 12, scratch) ? 1 : 0;
    for (let v = 0; v < 5; v++) sortie[i * 6 + 1 + v] = scratch[v];
  }
  return sortie;
};

const lignes = [
  await compare({
    calcul: 'A1 visibilityDepth',
    fichier: 'packages/sdk-browser/hizDepth.ts',
    cas: profondeur,
    reference: ({ ids, pages: p, cam, viewport }) =>
      referenceVisibilityDepth(ids, p, cam, viewport),
    optimisee: ({ ids, pages: p, cam, viewport }) => visibilityDepth(ids, p, cam, viewport),
    options: { tours: 200, budgetMs: 2000 },
  }),
  await compare({
    calcul: 'A5 hizTestRect',
    fichier: 'packages/sdk-browser/hizOcclusion.ts',
    cas: [
      { nom: '20003 rectangles, 12 niveaux', entree: rects, taille: rects.length },
      { nom: 'aucun rectangle', entree: [], taille: 0 },
    ],
    reference: parcours(referenceHizTestRect, scratchReference),
    optimisee: parcours(hizTestRect, scratchOptimisee),
    options: { tours: 200, budgetMs: 2000 },
  }),
];

test('A1 et A5 rendent exactement les mêmes valeurs', () => {
  for (const ligne of lignes)
    assert.equal(ligne.difference, null, `${ligne.calcul} : ${ligne.difference}`);
});
depose('hiz', lignes);
