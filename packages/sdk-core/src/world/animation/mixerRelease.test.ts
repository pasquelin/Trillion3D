import test from 'node:test';
import assert from 'node:assert/strict';
import { Object3D } from '../object/object3d.ts';
import { Mixer, lendActionSampler, type SampleInto } from './mixer.ts';
import type { Clip, Track } from './clip.ts';

/** A scene with one node `b` and a clip of `duration` seconds moving it. */
function rig(duration: number) {
  const scene = new Object3D(),
    bone = new Object3D();
  bone.name = 'b';
  scene.add(bone);
  const track: Track = {
    name: 'b.position',
    kind: 'vector',
    times: Float32Array.of(0, duration),
    values: Float32Array.of(0, 0, 0, duration, 0, 0),
  };
  return { scene, clip: { name: 'c', duration, tracks: [track] } as Clip };
}

/** Lends a sampler that counts how many it bound and how many it was given back. */
function lend() {
  const count = { bound: 0, released: 0 };
  lendActionSampler({
    bind(_tracks: readonly Track[], fallback: SampleInto) {
      count.bound++;
      const out = new Float64Array(3),
        offsets = Uint32Array.of(0);
      return {
        offsets,
        at: 0,
        sample: (t: number) => (fallback(t, out, offsets), out),
        release: () => void count.released++,
      };
    },
  });
  return count;
}

test('a stopped action gives its sampler back and binds a new one when it plays again', () => {
  const count = lend();
  try {
    const { scene, clip } = rig(10),
      mixer = new Mixer(scene),
      action = mixer.play(clip);
    // The first update binds the tracks, the second samples them whole.
    mixer.update(1);
    mixer.update(1);
    assert.deepEqual(count, { bound: 1, released: 0 });
    action.stop();
    assert.deepEqual(count, { bound: 1, released: 1 });
    action.stop();
    assert.equal(count.released, 1);
    action.play();
    mixer.update(1);
    mixer.update(1);
    assert.deepEqual(count, { bound: 2, released: 1 });
    assert.equal(scene.children[0].position.x, 2);
  } finally {
    lendActionSampler(null);
  }
});

test('a once action that reaches its end gives its sampler back after its last sample', () => {
  const count = lend();
  try {
    const { scene, clip } = rig(2),
      mixer = new Mixer(scene),
      action = mixer.clipAction(clip);
    action.loop = 'once';
    action.play();
    mixer.update(0.5);
    mixer.update(0.5);
    assert.equal(count.released, 0);
    mixer.update(5);
    assert.equal(scene.children[0].position.x, 2);
    assert.deepEqual(count, { bound: 1, released: 1 });
  } finally {
    lendActionSampler(null);
  }
});

test('a once action blended with another gives its sampler back at its end, the other keeps its own', () => {
  const count = lend();
  try {
    const { scene, clip } = rig(2),
      other = rig(100).clip,
      mixer = new Mixer(scene);
    for (const c of [clip, other]) {
      const action = mixer.clipAction(c);
      action.weight = 0.5;
      action.play();
    }
    mixer.clipAction(clip).loop = 'once';
    mixer.update(1);
    mixer.update(0.5);
    assert.deepEqual(count, { bound: 2, released: 0 });
    mixer.update(5);
    assert.deepEqual(count, { bound: 2, released: 1 });
  } finally {
    lendActionSampler(null);
  }
});
