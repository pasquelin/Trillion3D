// The per-element loops of the world step (`webgpuPagesRender.ts`), on the root count of the
// reference scene: what a moving camera pays every image in JavaScript, timed on a nanosecond
// clock where the engine's own `worldMs` bound reads on a 0.1 ms one. This is the measurement
// #80 gates a WebAssembly kernel on: a loop under 0.1 ms per image keeps its JavaScript form.
import * as THREE from 'three';
import { mesure, rapport } from '../../core/index.ts';
import { rootWorldsToRenderOrigin } from '../../../packages/sdk-browser/src/gpu/dag/pack.ts';
import {
  refreshWorldStretch,
  worldsChanged,
} from '../../../packages/sdk-browser/src/gpu/dag/worlds.ts';
import type { DagRoot } from '../../../packages/sdk-browser/src/gpu/dag/types.ts';

/** Emerald Square, `--scene emerald-square`: 2 479 selection roots (campaign `l-80b`, #80). */
const ROOTS = 2479;
// Only `.world.elements` is read here: a fresh, empty-page root, built once outside the timed
// loops below.
const roots: DagRoot[] = Array.from({ length: ROOTS }, (_, i) => ({
  world: new THREE.Matrix4().fromArray([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, i, i * 2, i * 3, 1]),
  pages: [],
}));
const worlds = new Float32Array(ROOTS * 16);
const origin = [12345.5, 6.25, -700.125];
rootWorldsToRenderOrigin(worlds, roots, origin);
// The previous image's frame: the same roots one camera step earlier — every translation differs.
const previous = new Float32Array(ROOTS * 16);
rootWorldsToRenderOrigin(previous, roots, [origin[0] + 0.5, origin[1], origin[2] - 0.25]);
const packed = { worldCount: ROOTS, worldStretch: new Float32Array(ROOTS) };
const frameData = new Float32Array(ROOTS * 7 * 4);

const resultats = await mesure({
  name: 'world step loops',
  fichier: [
    'packages/sdk-browser/src/gpu/dag/pack.ts',
    'packages/sdk-browser/src/gpu/dag/worlds.ts',
  ],
  cas: [
    {
      name: 'root rebase, 2 479 roots',
      input: () => rootWorldsToRenderOrigin(worlds, roots, origin),
      size: ROOTS,
    },
    {
      name: 'change scan, first root moved',
      input: () => worldsChanged(previous, worlds),
      size: ROOTS,
    },
    { name: 'change scan, nothing moved', input: () => worldsChanged(worlds, worlds), size: ROOTS },
    {
      name: 'stretch scan, translations only moved',
      input: () => refreshWorldStretch(previous, worlds, packed, frameData),
      size: ROOTS,
    },
  ],
  calcul: (loop) => loop(),
  motif:
    'correctness held by cameraRenderOrigin.test.ts and gpuDagWorlds.test.ts; these lines time the loops',
  options: { tours: 500, budgetMs: 1500 },
});

rapport('rebase-racines', [resultats]);
