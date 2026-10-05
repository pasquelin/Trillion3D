// Three.js vs the engine in a browser world, animation: a frame of the world's loop advancing every
// playing mixer (`advanceMixers`, `packages/sdk-core/src/world/animation/mixer.ts`) with the
// WebAssembly sampler the world lends them (`packages/sdk-browser/src/math/batchAnimation.ts`),
// against `AnimationMixer.update` on the same clips, on the rigs of `support/animationRigs.ts`.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { prepareSdkWasm } from '../../../packages/sdk-browser/src/page/decode/geometryPageWasm.ts';
import { lendAnimationSampler } from '../../../packages/sdk-browser/src/math/batchAnimation.ts';
import { advanceMixers } from '../../../packages/sdk-core/src/world/animation/mixer.ts';
import { rapport } from '../../core/index.ts';
import { duel } from '../../oracles/core/three-duel.ts';
import { FRAME, NODES, animationRigs } from './support/animationRigs.ts';

await prepareSdkWasm(
  readFileSync(
    join(import.meta.dirname, '../../../packages/sdk-browser/src/page/decode/pageCodec.wasm'),
  ),
);
await lendAnimationSampler();

const { scene, bones, bonesThree, mixersThree } = animationRigs();

/** Every bone's position then rotation, seven numbers per bone. */
const poses = new Float64Array(NODES * 7),
  posesThree = new Float64Array(NODES * 7);
type Pose = { position: THREE.Vector3Like; quaternion: THREE.QuaternionLike };
function read(nodes: Pose[], out: Float64Array) {
  for (let i = 0; i < nodes.length; i++) {
    const { position: p, quaternion: q } = nodes[i],
      at = i * 7;
    [out[at], out[at + 1], out[at + 2]] = [p.x, p.y, p.z];
    [out[at + 3], out[at + 4], out[at + 5], out[at + 6]] = [q.x, q.y, q.z, q.w];
  }
  return out;
}

const lines = [
  await duel({
    name: 'AnimationMixer.update, 400 rigs',
    fichier: [
      'packages/sdk-core/src/world/animation/mixer.ts',
      'packages/sdk-browser/src/math/batchAnimation.ts',
    ],
    size: NODES,
    three: () => {
      for (const mixer of mixersThree) mixer.update(FRAME);
    },
    oracle: () => read(bonesThree, posesThree),
    // Both sides only advance under the chronometer; each side's poses are read untimed.
    core: () => advanceMixers(scene, FRAME),
    readCore: () => read(bones, poses),
    // Three samples into the track's own f32 buffer; the engine keeps doubles. Half an f32 ulp
    // of a key in [-2, 2] is 1.2e-7: the bound keeps a factor of four over it.
    tolerance: 5e-7,
    // Measured 0.86-1.10x (paired medians, 5 runs) on a machine loaded to 90 (Oct. 2026), 0.65-0.68x
    // in minima: faster at the median; the ceiling is that measure plus the load's margin.
    slower: { atMost: 1.15, reason: 'at least as fast at the median; margin for a loaded machine' },
    motif: 'Three rounds each sample to single precision, the engine does not',
  }),
];

rapport(
  'animation-sampler',
  lines,
  'the engine animation poses like Three.js, at least as fast, with the WebAssembly sampler',
);
