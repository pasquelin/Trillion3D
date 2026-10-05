// The animation samples taken ahead on a worker (`animationAhead.ts`, `animationWorker.ts`), on a
// real `worker_threads` thread: rigs that play alone, cross-fade, blend under weight 1 and add a
// motion on top, through frames whose delta mostly repeats, sometimes changes or stops, and whose
// actions are played, stopped, sought, sped up and re-weighted along the way; some frames do not
// wait for the worker's buffer. Every written number must carry the bits the main thread alone
// writes, and the worker must have answered most samples.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NodeDomWorker } from '../../../../bench/oracles/browser/pageDecodeNodeWorker.ts';
import { prepareSdkWasm } from '../page/decode/geometryPageWasm.ts';
import { sampleAhead, type AheadPort } from './animationAhead.ts';
import { countingSampler } from './animationAhead.fixture.ts';
import { lendAnimationSampler } from './batchAnimation.ts';
import { Object3D } from '../../../sdk-core/src/world/object/object3d.ts';
import {
  Mixer,
  advanceMixers,
  lendActionSampler,
  type Action,
} from '../../../sdk-core/src/world/animation/mixer.ts';
import type { Clip, Track } from '../../../sdk-core/src/world/animation/clip.ts';
import { assertBits } from '../../../../tests/kit/assert/bits.ts';

await prepareSdkWasm(readFileSync(join(import.meta.dirname, '../page/decode/pageCodec.wasm')));

let seed = 11;
const random = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0), seed / 4294967296);

const BONES = 4,
  KEYS = 9,
  RIGS = 12,
  FRAMES = 360;
const times = Float32Array.from({ length: KEYS }, (_, k) => k / (KEYS - 1));
/** A clip of `BONES` bones, a position, a rotation and a cubic scale track each. */
function clip(name: string, duration: number): Clip {
  const tracks: Track[] = [];
  for (let b = 0; b < BONES; b++) {
    const rotations = new Float32Array(KEYS * 4);
    for (let k = 0; k < KEYS; k++) {
      const q = [random() - 0.5, random() - 0.5, random() - 0.5, random() - 0.5],
        length = Math.hypot(...q);
      rotations.set(
        q.map((v) => v / length),
        k * 4,
      );
    }
    const vectors = (n: number) => Float32Array.from({ length: n }, () => (random() - 0.5) * 4);
    tracks.push(
      { name: `b${b}.position`, kind: 'vector', times, values: vectors(KEYS * 3) },
      { name: `b${b}.quaternion`, kind: 'quaternion', times, values: rotations },
      {
        name: `b${b}.scale`,
        kind: 'vector',
        times,
        values: vectors(KEYS * 9),
        interpolation: 'cubic',
      },
    );
  }
  return { name, duration, tracks };
}
const clips = [clip('walk', 1), clip('run', 0.7), clip('nod', 0.4)];

/** A wrapper of the thread's port that counts the buffers out and back. */
function counted(worker: NodeDomWorker) {
  const port = {
    out: 0,
    back: 0,
    onmessage: null as AheadPort['onmessage'],
    postMessage(message: unknown, transfer: ArrayBuffer[]) {
      if (message instanceof ArrayBuffer) port.out++;
      worker.postMessage(message, transfer);
    },
  };
  worker.onmessage = (event) => {
    if (event.data instanceof ArrayBuffer) port.back++;
    port.onmessage?.(event);
  };
  return port;
}

/** The scripted run: every written number of every frame; `settle` between frames. */
async function play(settle: (frame: number) => Promise<void>) {
  seed = 99;
  const scene = new Object3D(),
    nodes: Object3D[] = [],
    actions: Action[][] = [];
  for (let r = 0; r < RIGS; r++) {
    const root = new Object3D();
    for (let b = 0; b < BONES; b++) {
      const bone = new Object3D();
      bone.name = `b${b}`;
      root.add(bone);
      nodes.push(bone);
    }
    scene.add(root);
    const mixer = new Mixer(root),
      [walk, run, nod] = clips.map((c) => mixer.clipAction(c));
    walk.loop = (['repeat', 'pingpong', 'once'] as const)[r % 3];
    run.timeScale = r % 2 ? 1.25 : -0.5;
    nod.blendMode = 'additive';
    walk.play();
    // A third play alone, a third cross-fade, a third under weight 1 with a nod on top.
    if (r % 3 === 1) run.play().weight = 0;
    if (r % 3 === 2) {
      walk.weight = 0.6;
      nod.play().weight = 0.5;
    }
    actions.push([walk, run, nod]);
  }
  const written: number[] = [];
  for (let frame = 0; frame < FRAMES; frame++) {
    for (const [r, [walk, run, nod]] of actions.entries()) {
      if (r % 3 === 1) {
        // The cross-fade, every frame a new weight: the samples stay the worker's.
        const w = (frame % 90) / 90;
        walk.weight = 1 - w;
        run.weight = w;
      }
      if (frame === 100 + r) walk.seek(0.3);
      if (frame === 150 && r % 4 === 0) walk.timeScale = 1.5;
      if (frame === 200 && r % 5 === 0) walk.stop();
      if (frame === 220 && r % 5 === 0) walk.play();
      if (frame === 260 && r % 3 === 0) nod.play().blendMode = 'additive';
      if (frame === 300 && r % 3 === 2) nod.stop();
    }
    // A fixed step, a few changed deltas, a pause.
    const delta = frame % 97 === 50 ? 1 / 30 : frame % 61 === 7 ? 0 : 1 / 60;
    advanceMixers(scene, delta);
    for (const node of nodes)
      written.push(...node.position.elements, ...node.quaternion.elements, ...node.scale.elements);
    await settle(frame);
  }
  return written;
}

test('the samples a worker takes ahead write the bits the main thread alone writes', async (t) => {
  const lent = (await lendAnimationSampler())!;
  sampleAhead(null);
  const reference = await play(async () => {});
  const { sampler, counts } = countingSampler(lent);

  const worker = new NodeDomWorker(new URL('./animationWorker.fixture.ts', import.meta.url));
  const port = counted(worker),
    start = () => port;
  try {
    lendActionSampler(sampler);
    sampleAhead(start);
    const ahead = await play(async (frame) => {
      // One frame in seven does not wait: its buffer comes back late or not at all.
      if (frame % 7 === 3) return;
      const deadline = Date.now() + 10_000;
      while (port.back < port.out && Date.now() < deadline)
        await new Promise((resolve) => setImmediate(resolve));
    });
    const { asked, taken, missed } = counts;
    t.diagnostic(
      `samples asked ${asked}, read from the worker ${taken}, computed here ${missed}; ` +
        `buffers ${port.out} out, ${port.back} back`,
    );
    assertBits(ahead, reference, 'ahead on the worker');
    assert.ok(port.out > FRAMES / 2, `buffers sent: ${port.out}`);
    assert.ok(taken > 2 * missed, `read from the worker ${taken}, computed here ${missed}`);
    assert.ok(missed > 0, 'a changed delta, a seek or a late buffer is computed here');
  } finally {
    sampleAhead(null);
    lendActionSampler(null);
    await worker.terminate();
  }
});
