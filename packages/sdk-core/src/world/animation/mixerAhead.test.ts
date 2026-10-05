import test from 'node:test';
import assert from 'node:assert/strict';
import { Object3D } from '../object/object3d.ts';
import { Mixer, advanceMixers, lendActionSampler, type SampleInto } from './mixer.ts';
import type { Clip, Track } from './clip.ts';
import { viewScene } from './mixerHold.ts';

test('frames on a step ask the next sample one step on, a dropped frame and a still one kept', () => {
  const bone = new Object3D(),
    scene = new Object3D();
  bone.name = 'b';
  scene.add(bone);
  const track: Track = {
    name: 'b.position',
    kind: 'vector',
    times: Float32Array.of(0, 10),
    values: Float32Array.of(0, 0, 0, 10, 0, 0),
  };
  const clip: Clip = { name: 'c', duration: 10, tracks: [track] };
  const asked: (number | null)[] = [];
  let frame = -1;
  lendActionSampler({
    bind(tracks: readonly Track[], fallback: SampleInto) {
      const out = new Float64Array(3),
        offsets = Uint32Array.of(0);
      return {
        offsets,
        at: 0,
        sample: (t: number) => (fallback(t, out, offsets), out),
        ahead: (t: number) => void (asked[frame] = t),
        release() {},
      };
    },
  });
  try {
    const action = new Mixer(scene).play(clip);
    const P = 1 / 120;
    // Three steps find it; a dropped frame (two steps), a frame read twice (none), a wall clock's
    // delta (no step: nothing asked until it repeats again).
    const deltas = [P, P, P, 2 * P, 0, P, 0.013, P, P, P];
    let time = 0;
    for (const [i, delta] of deltas.entries()) {
      frame = i;
      asked[i] = null;
      advanceMixers(scene, delta);
      time += delta;
      if (asked[i] !== null) assert.ok(Math.abs(asked[i]! - (time + P)) < 1e-12, `frame ${i}`);
    }
    assert.deepEqual(
      asked.map((t) => t !== null),
      [false, false, true, true, true, true, false, false, false, true],
    );
    action.stop();
  } finally {
    lendActionSampler(null);
  }
});

test('a held frame asks nothing ahead; the frame after a hold finds its sample asked', () => {
  const bone = new Object3D(),
    scene = new Object3D();
  bone.name = 'b';
  scene.add(bone);
  const track: Track = {
    name: 'b.position',
    kind: 'vector',
    times: Float32Array.of(0, 10),
    values: Float32Array.of(0, 0, 0, 10, 0, 0),
  };
  const clip: Clip = { name: 'c', duration: 10, tracks: [track] };
  // One metre a second, 300 m away on a 1000-pixel focal length: 3.3 px a second, a write
  // every ninth frame or so at 60 Hz.
  viewScene(scene, () => ({
    eye: [0, 0, 300],
    forward: [0, 0, -1],
    focal: 1000,
    near: 0.1,
    perspective: 1,
  }));
  const asked: (number | null)[] = [],
    sampled: (number | null)[] = [];
  let frame = -1;
  lendActionSampler({
    bind(tracks: readonly Track[], fallback: SampleInto) {
      const out = new Float64Array(3),
        offsets = Uint32Array.of(0);
      return {
        offsets,
        at: 0,
        sample: (t: number) => ((sampled[frame] = t), fallback(t, out, offsets), out),
        ahead: (t: number) => void (asked[frame] = t),
        release() {},
      };
    },
  });
  try {
    const action = new Mixer(scene).play(clip);
    for (frame = 0; frame < 120; frame++) {
      asked[frame] = sampled[frame] = null;
      advanceMixers(scene, 1 / 60);
    }
    // From the first frame sampled through the lent sampler: the frames before it bound none.
    let holds = 0;
    for (let f = sampled.findIndex((t) => t !== null) + 1; f < 120; f++) {
      if (sampled[f] === null) {
        holds++;
        assert.equal(asked[f - 1], null, `frame ${f - 1} asked for a held frame`);
      } else assert.equal(asked[f - 1], sampled[f], `frame ${f} was not asked`);
    }
    assert.ok(holds > 60, `${holds}`);
    action.stop();
  } finally {
    lendActionSampler(null);
    viewScene(scene, null);
  }
});
