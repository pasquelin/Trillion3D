// CPU visbuffer shading, pixel by pixel.
import * as THREE from 'three';
import { shadeVisibility } from '../../../packages/sdk-browser/src/visibility/shader/shade.ts';
import { rasterVisibility } from '../../../packages/sdk-browser/src/visibility/raster.ts';
import { mesure, stress, rapport } from '../../core/index.ts';
import { camera, coupe } from './support/scenes.ts';
import { referenceShadeVisibility } from '../../oracles/browser/ombrage-image.ts';
import { cameraMoteur } from '../../../packages/sdk-browser/src/camera/camera.fixture.ts';
import type { ScenePage } from './support/scenes.ts';

const image = (
  largeur: number,
  hauteur: number,
  material: THREE.Material,
  pages_?: ScenePage[],
) => {
  const cam = camera(6, 0.1, largeur / hauteur),
    viewport: [number, number] = [largeur, hauteur];
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
  { name: '256×144 MeshBasic', input: image(256, 144, basique), size: 256 * 144 },
  { name: '256×144 MeshStandard', input: image(256, 144, standard), size: 256 * 144 },
  { name: 'background only 128×72', input: image(128, 72, basique, []), size: 128 * 72 },
  {
    name: '640×360 MeshStandard',
    input: image(640, 360, standard),
    size: 640 * 360,
    mesure: false,
  },
];

const res = await mesure({
  name: 'shadeVisibility',
  fichier: 'packages/sdk-browser/src/visibility/shader/shadePixel.ts',
  cas,
  calcul: ({ ids, pages, cam, viewport }) =>
    shadeVisibility(ids, pages, cameraMoteur(cam), viewport),
  attendu: ({ ids, pages, cam, viewport }) => referenceShadeVisibility(ids, pages, cam, viewport),
  options: { tours: 60, budgetMs: 1500 },
});

await stress({
  name: 'shadeVisibility extremes',
  calcul: ({ ids, pages, cam, viewport }) =>
    shadeVisibility(ids, pages, cameraMoteur(cam), viewport),
  extremes: [
    { name: 'empty', input: image(32, 32, basique, []) },
    {
      name: '1 pixel',
      input: { ids: new Uint32Array(1), pages: [], cam: camera(6, 0.1, 1), viewport: [1, 1] },
    },
  ],
});

rapport('ombrage-image', [res], 'A2 yields the exact same bytes');
