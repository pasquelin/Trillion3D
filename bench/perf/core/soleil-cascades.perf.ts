// sun cascade bounds.
import {
  LIGHT_SETTINGS,
  type ShadowViewpoint,
} from '../../../packages/sdk-core/src/scene/light/contracts.ts';
import { sunCascadeOf } from '../../../packages/sdk-core/src/scene/light-shadow/sunCascades.ts';
import { graine, mesure, stress, rapport } from '../../core/index.ts';
import type { MesureCas } from '../../core/index.ts';
import { referenceSunCascadeOf } from '../../oracles/core/soleil-cascades.ts';
import { HOSTILE_FLOATS } from '../../../tests/kit/assert/hostile.ts';

const alea = graine(0x508);
const AXE: readonly [number, number, number] = [0.3, -0.9, 0.31];

const vue = (near: number, far: number, aspect: number, halfFovY: number): ShadowViewpoint => ({
  position: [alea() * 20 - 10, alea() * 6, alea() * 20 - 10],
  forward: [0, 0, -1],
  halfFovY,
  aspect,
  near,
  far,
});

const HOSTILES = [...HOSTILE_FLOATS, 1.7976931348623157e308, -1];
const images: ShadowViewpoint[] = [];
for (let i = 0; i < 400; i++) images.push(vue(0.05 + alea(), 100 + alea() * 900, 16 / 9, 0.5));
const immobiles: ShadowViewpoint[] = [];
for (let i = 0; i < 400; i++) immobiles.push(vue(0.1, 500, 16 / 9, 0.6));
const hostiles: ShadowViewpoint[] = [];
for (const near of HOSTILES) for (const far of HOSTILES) hostiles.push(vue(near, far, 1, 0.7));

// The oracle predates the page-aligned window: the two sides share the split cache and the
// frustum sphere, hence the radius, and that is what the comparison holds.
const faces =
  (
    cascadeDe: (
      view: ShadowViewpoint,
      axis: readonly [number, number, number],
      index: number,
      side: number,
    ) => { radius: number },
  ) =>
  (views: readonly ShadowViewpoint[]) => {
    const output = new Float64Array(views.length * LIGHT_SETTINGS.sunCascades);
    let at = 0;
    for (const view of views)
      for (let face = 0; face < LIGHT_SETTINGS.sunCascades; face++)
        output[at++] = cascadeDe(view, AXE, face, 2048).radius;
    return output;
  };

const cas: MesureCas<ShadowViewpoint[]>[] = [
  { name: '400 moving views', input: images, size: 400 },
  { name: '400 images vue immobile', input: immobiles, size: 400 },
  { name: 'distances hostiles', input: hostiles, size: hostiles.length },
  { name: 'une seule vue', input: [images[0]], size: 1 },
  { name: 'aucune vue', input: [], size: 0 },
];

const res = await mesure({
  name: 'bornes cascade soleil',
  fichier: 'packages/sdk-core/src/scene/light-shadow/sunCascades.ts',
  cas,
  calcul: faces(sunCascadeOf),
  attendu: faces(referenceSunCascadeOf),
  options: { tours: 100, budgetMs: 1500 },
});

await stress({
  name: 'sunCascadeOf extremes',
  calcul: (v: ShadowViewpoint) => sunCascadeOf(v, AXE, 0, 2048),
  extremes: [
    { name: 'near=far', input: vue(10, 10, 1, 0.5) },
    { name: 'near negatif', input: vue(-5, 50, 1, 0.5) },
    { name: 'fov infini', input: vue(0.1, 100, 1, Infinity) },
  ],
});

rapport('soleil-cascades', [res], 'G8 yields the exact same cascade bounds');
