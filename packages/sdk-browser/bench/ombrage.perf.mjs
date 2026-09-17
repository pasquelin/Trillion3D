// A2 : l'ombrage CPU du visbuffer, pixel par pixel.
import * as THREE from 'three';
import { shadeVisibility } from '../visibilityShade.ts';
import { rasterVisibility } from '../visibilityRaster.ts';
import { mesure, stress, rapport } from '../../sdk-core/bench/mesure.mjs';
import { camera, coupe } from './scenes.mjs';
import { referenceShadeVisibility } from './oracles/ombrage.mjs';
import { cameraMoteur } from '../cameraFixture.ts';

const image = (largeur, hauteur, material, pages_) => {
  const cam = camera(6, 0.1, largeur / hauteur),
    viewport = [largeur, hauteur];
  const pages = pages_ ?? coupe({ pages: 900, triangles: 48, material });
  return { ids: rasterVisibility(pages, cameraMoteur(cam), viewport).ids, pages, cam, viewport };
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

const res = await mesure({
  nom: 'A2 shadeVisibility',
  fichier: 'packages/sdk-browser/visibilityShadePixel.ts',
  cas,
  calcul: ({ ids, pages, cam, viewport }) =>
    shadeVisibility(ids, pages, cameraMoteur(cam), viewport),
  attendu: ({ ids, pages, cam, viewport }) =>
    referenceShadeVisibility(ids, pages, cam, viewport),
  options: { tours: 60, budgetMs: 1500 },
});

await stress({
  nom: 'shadeVisibility extremes',
  calcul: ({ ids, pages, cam, viewport }) =>
    shadeVisibility(ids, pages, cameraMoteur(cam), viewport),
  extremes: [
    { nom: 'vide', entree: image(32, 32, basique, []) },
    { nom: '1 pixel', entree: { ids: new Uint32Array(1), pages: [], cam: camera(6, 0.1, 1), viewport: [1, 1] } },
  ],
});

rapport('ombrage', [res], 'A2 rend exactement les mêmes octets');
