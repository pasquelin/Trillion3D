// sun cascade bounds.
import { LIGHT_SETTINGS } from '../sceneLightContracts.ts';
import { sunCascadeOf } from '../sceneLightSunCascades.ts';
import { graine, mesure, stress, rapport } from './socle.mjs';
import { referenceSunCascadeOf } from './oracles/soleil-cascades.mjs';

const alea = graine(0x508);
const AXE = [0.3, -0.9, 0.31];

const vue = (near, far, aspect, halfFovY) => ({
  position: [alea() * 20 - 10, alea() * 6, alea() * 20 - 10],
  forward: [0, 0, -1],
  halfFovY,
  aspect,
  near,
  far,
});

const HOSTILES = [0, -0, NaN, Infinity, -Infinity, 5e-324, 1.7976931348623157e308, -1];
const images = [];
for (let i = 0; i < 400; i++) images.push(vue(0.05 + alea(), 100 + alea() * 900, 16 / 9, 0.5));
const immobiles = [];
for (let i = 0; i < 400; i++) immobiles.push(vue(0.1, 500, 16 / 9, 0.6));
const hostiles = [];
for (const near of HOSTILES) for (const far of HOSTILES) hostiles.push(vue(near, far, 1, 0.7));

const faces = (cascadeDe) => (views) => {
  const output = new Float64Array(views.length * LIGHT_SETTINGS.sunCascades * 7);
  let at = 0;
  for (const view of views) {
    for (let face = 0; face < LIGHT_SETTINGS.sunCascades; face++) {
      const c = cascadeDe(view, AXE, face, 2048);
      output[at++] = c.center[0];
      output[at++] = c.center[1];
      output[at++] = c.center[2];
      output[at++] = c.radius;
      output[at++] = c.boxCenter[0];
      output[at++] = c.boxCenter[1];
      output[at++] = c.boxCenter[2];
    }
  }
  return output;
};

const cas = [
  { name: '400 vues qui bougent', input: images, size: 400 },
  { name: '400 images vue immobile', input: immobiles, size: 400 },
  { name: 'distances hostiles', input: hostiles, size: hostiles.length },
  { name: 'une seule vue', input: [images[0]], size: 1 },
  { name: 'aucune vue', input: [], size: 0 },
];

const res = await mesure({
  name: 'bornes cascade soleil',
  fichier: 'packages/sdk-core/sceneLightSunCascades.ts',
  cas,
  calcul: faces(sunCascadeOf),
  attendu: faces(referenceSunCascadeOf),
  options: { tours: 100, budgetMs: 1500 },
});

await stress({
  name: 'sunCascadeOf extremes',
  calcul: (v) => sunCascadeOf(v, AXE, 0, 2048),
  extremes: [
    { name: 'near=far', input: vue(10, 10, 1, 0.5) },
    { name: 'near negatif', input: vue(-5, 50, 1, 0.5) },
    { name: 'fov infini', input: vue(0.1, 100, 1, Infinity) },
  ],
});

rapport('soleil-cascades', [res], 'G8 yields the exact same cascade bounds');
