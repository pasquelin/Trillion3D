// A2 : l'ombrage CPU du visbuffer, pixel par pixel. Référence = `visibilityShadePixel.ts` et la
// boucle de `visibilityShade.ts` d'avant le lot A, recopiés dans `oracles/ombrage.mjs`.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { shadeVisibility } from '../../../packages/sdk-browser/visibilityShade.ts';
import { rasterVisibility } from '../../../packages/sdk-browser/visibilityRaster.ts';
import { compare, depose } from './banc.mjs';
import { camera, coupe } from './scenes.mjs';
import { referenceShadeVisibility } from './oracles/ombrage.mjs';

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
