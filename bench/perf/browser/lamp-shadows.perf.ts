// what lamp shadows cost on the CPU: world-space cluster spheres packed for the shadow
// pass, the screen coverage that ranks lamps, and the plan of faces to redraw when the
// scene moves.
import * as THREE from 'three';
import { screenCoverage } from '../../../packages/sdk-core/src/scene/light-shadow/counts.ts';
import { createSceneLightStore } from '../../../packages/sdk-core/src/scene/light/store.ts';
import { createShadowPlan } from '../../../packages/sdk-core/src/scene/light-shadow/plan.ts';
import { packClusterSpheres } from '../../../packages/sdk-browser/src/webgpu/shadow/bounds.ts';
import { graine, mesure, stress, rapport } from '../../core/index.ts';
import {
  referenceClusterSphere,
  referenceScreenCoverage,
} from '../../oracles/browser/lamp-shadows.ts';
import { pageRecFixture } from './support/pageRecFixture.ts';
import type { PageRec } from '../../../packages/sdk-browser/src/page/selection/types.ts';
import type { ShadowViewpoint } from '../../../packages/sdk-core/src/index.ts';

const alea = graine(83);

// One record in ten is empty: the pass must write a zero radius there, never read a missing card.
// The output buffer belongs to the case, allocated once, as the engine holds its own.
function clusters(nombre: number) {
  const recs: (PageRec | undefined)[] = [];
  for (let i = 0; i < nombre; i++) {
    const elements = new Float64Array(16);
    for (let j = 0; j < 16; j++) elements[j] = (alea() - 0.5) * 10;
    const min = [(alea() - 0.5) * 5, (alea() - 0.5) * 5, (alea() - 0.5) * 5];
    const max = [min[0] + alea() * 5, min[1] + alea() * 5, min[2] + alea() * 5];
    recs.push(
      i % 10 === 9
        ? undefined
        : pageRecFixture({ matrix: new THREE.Matrix4().fromArray(elements), min, max }),
    );
  }
  return { recs, packed: new Float32Array(nombre * 4) };
}

const mesSpheres = await mesure({
  name: 'world-space cluster spheres',
  fichier: 'packages/sdk-browser/src/webgpu/shadow/bounds.ts',
  cas: [
    { name: '20 000 clusters', input: clusters(20000), size: 20000 },
    { name: '1 cluster', input: clusters(1), size: 1 },
    { name: 'none', input: clusters(0), size: 0 },
  ],
  calcul: ({ recs, packed }) => packClusterSpheres(recs, packed, 0, recs.length - 1),
  attendu: ({ recs }) => {
    const output = new Float32Array(recs.length * 4);
    recs.forEach((rec, i) => rec && referenceClusterSphere(rec, output, i * 4));
    return output;
  },
});

const vue: ShadowViewpoint = {
  position: [0, 0, 0],
  forward: [0, 0, -1],
  aspect: 1,
  near: 0.1,
  far: 1000,
  halfFovY: Math.PI / 4,
};

interface Lampe {
  x: number;
  y: number;
  z: number;
  range: number;
}

const lampes = (nombre: number) => ({
  liste: Array.from({ length: nombre }, (): Lampe => ({
    x: (alea() - 0.5) * 100,
    y: (alea() - 0.5) * 100,
    z: (alea() - 0.5) * 100,
    range: alea() * 50,
  })),
  output: new Float64Array(nombre),
});

const couverture =
  (calcule: (view: ShadowViewpoint, x: number, y: number, z: number, range: number) => number) =>
  ({ liste, output }: { liste: Lampe[]; output: Float64Array }) => {
    for (let i = 0; i < liste.length; i++) {
      const l = liste[i];
      output[i] = calcule(vue, l.x, l.y, l.z, l.range);
    }
    return output;
  };

const mesCouverture = await mesure({
  name: 'lamp screen coverage',
  fichier: 'packages/sdk-core/src/scene/light-shadow/counts.ts',
  cas: [
    { name: '10 000 lamps', input: lampes(10000), size: 10000 },
    { name: '1 lamp', input: lampes(1), size: 1 },
  ],
  calcul: couverture(screenCoverage),
  attendu: couverture(referenceScreenCoverage),
});

function scene(nombre: number) {
  const store = createSceneLightStore();
  for (let i = 0; i < nombre; i++)
    store.add({
      id: `light-${i}`,
      kind: 'point',
      position: [(alea() - 0.5) * 50, alea() * 10, (alea() - 0.5) * 50],
      color: [1, 1, 1],
      intensity: 100,
      range: 20,
      castsShadow: true,
    });
  return { store, plan: createShadowPlan(nombre), frame: 0 };
}

// Each frame, a node moves within lamp range: invalidation and admission work. A still
// scene would cost nothing, and that would be the published figure.
const mesOrdonnancement = await mesure({
  name: 'shadow-face plan',
  fichier: 'packages/sdk-core/src/scene/light-shadow/plan.ts',
  cas: [{ name: '32 lamps, moving scene', input: scene(32), size: 32 }],
  calcul: (s) => {
    s.frame++;
    const x = (s.frame % 40) - 20;
    s.plan.worldChanged([x, 0, x], [x + 2, 2, x + 2]);
    return s.plan.plan(s.store, vue, s.frame, s.frame * 16.6);
  },
  motif:
    'correctness held by packages/sdk-core/src/scene/light-shadow/plan.test.ts; the oracle would be a second scheduler',
});

await stress({
  name: 'extreme screen coverage',
  calcul: ([x, y, z, range]) => screenCoverage(vue, x, y, z, range),
  extremes: [
    { name: 'zero range', input: [0, 0, 0, 0] },
    { name: 'infinite range', input: [0, 0, 0, Infinity] },
    { name: 'on the eye', input: [0, 0, 0, 10] },
    { name: 'NaN', input: [NaN, NaN, NaN, 10] },
  ],
});

rapport(
  'lampes-ombres',
  [mesSpheres, mesCouverture, mesOrdonnancement],
  'the spheres and the coverage yield the same values',
);
