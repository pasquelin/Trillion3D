// A2 : l'ombrage CPU du visbuffer, pixel par pixel. Référence = `visibilityShadePixel.ts` et la
// boucle de `visibilityShade.ts` d'avant le lot A, recopiés tels quels.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RASTER_BACKGROUND } from '../../../packages/sdk-browser/pageRaster.ts';
import {
  attr2,
  backgroundRgb,
  barycentric,
  linearToSrgb8,
  perspectiveBary,
  sampleLinear,
  sampleMap,
  triangleAt,
} from '../../../packages/sdk-browser/visibilityMath.ts';
import { shadeLit } from '../../../packages/sdk-browser/visibilityLighting.ts';
import { unpackVisibilityId, visMaterial } from '../../../packages/sdk-browser/visibilityTypes.ts';
import { shadeVisibility } from '../../../packages/sdk-browser/visibilityShade.ts';
import { rasterVisibility } from '../../../packages/sdk-browser/visibilityRaster.ts';
import { compare, depose } from './banc.mjs';
import { camera, coupe } from './scenes.mjs';

/** `visibilityShadePixel.ts:15-63` avant le lot A : `visMaterial` et le triangle par pixel. */
function referenceShadePixel(id, pages, cam, viewProj, width, height, x, y, background) {
  const unpacked = unpackVisibilityId(id);
  if (!unpacked) return backgroundRgb(background);
  const page = pages[unpacked.pageIndex];
  if (!page) return backgroundRgb(background);
  const tri = triangleAt(page, unpacked.triangleIndex, viewProj, width, height);
  if (!tri) return backgroundRgb(background);
  const affine = barycentric(tri.a, tri.b, tri.c, x, y);
  if (!affine) return backgroundRgb(background);
  const bary = perspectiveBary(tri.a, tri.b, tri.c, affine);
  const uv = attr2(page.attributes.uv, tri.i0, tri.i1, tri.i2, bary.w0, bary.w1, bary.w2);
  const mat = visMaterial(page.material);
  let rgb = [mat.baseColor[0], mat.baseColor[1], mat.baseColor[2]];
  if (mat.map) {
    const sample = sampleMap(mat.map, uv[0], uv[1]);
    rgb = [rgb[0] * sample[0], rgb[1] * sample[1], rgb[2] * sample[2]];
  }
  let metalness = mat.metalness,
    roughness = mat.roughness;
  if (mat.metalnessMap)
    metalness = Math.min(
      1,
      Math.max(0, metalness * sampleLinear(mat.metalnessMap, uv[0], uv[1])[2]),
    );
  if (mat.roughnessMap)
    roughness = Math.min(
      1,
      Math.max(0, roughness * sampleLinear(mat.roughnessMap, uv[0], uv[1])[1]),
    );
  const encode = (c) =>
    mat.map || mat.lit
      ? [linearToSrgb8(c[0]), linearToSrgb8(c[1]), linearToSrgb8(c[2])]
      : [
          Math.max(0, Math.min(255, c[0] * 255)) | 0,
          Math.max(0, Math.min(255, c[1] * 255)) | 0,
          Math.max(0, Math.min(255, c[2] * 255)) | 0,
        ];
  if (mat.lit) rgb = shadeLit(page, tri, affine, bary, uv, mat, rgb, metalness, roughness, cam);
  return encode(rgb);
}

/** `visibilityShade.ts:8-34` avant le lot A. */
function referenceShadeVisibility(ids, pages, cam, viewport, background = RASTER_BACKGROUND) {
  const [width, height] = viewport,
    pixels = new Uint8Array(width * height * 4);
  cam.updateMatrixWorld();
  const viewProj = new THREE.Matrix4().multiplyMatrices(
    cam.projectionMatrix,
    cam.matrixWorldInverse,
  );
  const bg = backgroundRgb(background);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const o = y * width + x,
        rgb = referenceShadePixel(ids[o], pages, cam, viewProj, width, height, x, y, background);
      const p = o * 4;
      pixels[p] = rgb[0] ?? bg[0];
      pixels[p + 1] = rgb[1] ?? bg[1];
      pixels[p + 2] = rgb[2] ?? bg[2];
      pixels[p + 3] = 255;
    }
  return pixels;
}

const image = (largeur, hauteur, material, pages_) => {
  const cam = camera(6, 0.1, largeur / hauteur),
    viewport = [largeur, hauteur];
  const pages = pages_ ?? coupe({ pages: 900, triangles: 48, material });
  return { ids: rasterVisibility(pages, cam, viewport).ids, pages, cam, viewport };
};
const basique = new THREE.MeshBasicMaterial({ color: 0x88aa44 });
const standard = new THREE.MeshStandardMaterial({
  color: 0x8844aa,
  roughness: 0.4,
  metalness: 0.2,
});
const cas = [
  { nom: '256×144 MeshBasic', entree: image(256, 144, basique), taille: 256 * 144 },
  { nom: '256×144 MeshStandard', entree: image(256, 144, standard), taille: 256 * 144 },
  { nom: 'fond seul 128×72', entree: image(128, 72, basique, []), taille: 128 * 72 },
  {
    nom: '640×360 MeshStandard',
    entree: image(640, 360, standard),
    taille: 640 * 360,
    mesure: false,
  },
];

const lignes = [
  await compare({
    calcul: 'A2 shadeVisibility',
    fichier: 'packages/sdk-browser/visibilityShadePixel.ts',
    cas,
    reference: ({ ids, pages, cam, viewport }) =>
      referenceShadeVisibility(ids, pages, cam, viewport),
    optimisee: ({ ids, pages, cam, viewport }) => shadeVisibility(ids, pages, cam, viewport),
    options: { tours: 60, budgetMs: 2000 },
  }),
];

test('A2 rend exactement les mêmes octets', () => {
  for (const ligne of lignes)
    assert.equal(ligne.difference, null, `${ligne.calcul} : ${ligne.difference}`);
});
depose('ombrage', lignes);
