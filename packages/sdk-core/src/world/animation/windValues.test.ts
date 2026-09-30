import test from 'node:test';
import assert from 'node:assert/strict';
import { windClip } from './wind.ts';
import { Object3D } from '../object/object3d.ts';
import { Quaternion } from '../math/quaternion.ts';
import { Vector3 } from '../math/vector3.ts';
import type { Track } from './index.ts';

function at(track: Track, time: number) {
  const index = track.times.findIndex((value) => Math.abs(value - time) < 1e-7);
  assert.ok(index >= 0, `key at ${time}`);
  return new Quaternion().fromArray(track.values, index * 4);
}
function same(actual: Quaternion, expected: Quaternion) {
  actual.toArray().forEach((value, i) => assert.ok(Math.abs(value - expected.toArray()[i]) < 1e-7));
}

test('wind clips cover one period, close continuously and reach the declared lean at mid-cycle', () => {
  const bone = new Object3D();
  bone.name = 'leaf';
  const clip = windClip([bone], { angle: 0.4, frequency: 2 });
  assert.equal(clip.name, 'wind');
  assert.equal(clip.duration, 0.5);
  assert.equal(clip.tracks.length, 1);
  const track = clip.tracks[0];
  assert.equal(track.name, 'leaf.quaternion');
  assert.equal(track.kind, 'quaternion');
  assert.equal(track.times[0], 0);
  assert.equal(track.times.at(-1), clip.duration);
  assert.equal(track.values.length, track.times.length * 4);
  for (let i = 1; i < track.times.length; i++) {
    assert.ok(track.times[i] > track.times[i - 1]);
    assert.ok(track.times[i] - track.times[i - 1] <= clip.duration / 24 + 1e-7);
  }
  for (const [time, angle] of [
    [0, 0.08],
    [0.125, 0.24],
    [0.25, 0.4],
    [0.375, 0.24],
    [0.5, 0.08],
  ])
    same(at(track, time), new Quaternion().setFromAxisAngle(new Vector3(0, 0, -1), angle));
  assert.deepEqual(bone.quaternion.toArray(), [0, 0, 0, 1]);
});

test('ground-plane wind direction is normalized and pushes the upright tip toward that direction', () => {
  const bone = new Object3D();
  const first = windClip([bone], { direction: [3, 4], angle: 0.6, frequency: 1 });
  const scaled = windClip([bone], { direction: [6, 8], angle: 0.6, frequency: 1 });
  assert.deepEqual(first.tracks[0].values, scaled.tracks[0].values);
  const bent = new Vector3(0, 1, 0).applyQuaternion(at(first.tracks[0], 0.5));
  const expected = [0.6 * Math.sin(0.6), Math.cos(0.6), 0.8 * Math.sin(0.6)];
  bent.toArray().forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < 1e-7));
});

test('outer foliage bends more and reaches peak later than the inner bone', () => {
  const inner = new Object3D(),
    outer = new Object3D();
  inner.name = 'branch';
  outer.name = 'leaf';
  const clip = windClip([inner, outer], { angle: 0.6, frequency: 1 });
  same(at(clip.tracks[0], 0.375), new Quaternion().setFromAxisAngle(new Vector3(0, 0, -1), 0.3));
  same(at(clip.tracks[1], 0.5), new Quaternion().setFromAxisAngle(new Vector3(0, 0, -1), 0.6));
  same(
    at(clip.tracks[0], 0),
    new Quaternion().setFromAxisAngle(new Vector3(0, 0, -1), 0.09514718625761429),
  );
});

test('the wind axis stays in world space with a rotated parent and a nonidentity rest pose', () => {
  const parent = new Object3D(),
    bone = new Object3D();
  parent.add(bone);
  parent.rotation.set(0.3, -0.7, 1.1);
  bone.rotation.set(0.2, 0.5, -0.4);
  const restWorld = bone.getWorldQuaternion();
  const parentWorld = parent.getWorldQuaternion();
  const clip = windClip([bone], { angle: 0.4, frequency: 1 });
  const actualWorld = parentWorld.multiply(at(clip.tracks[0], 0.5));
  const expectedWorld = new Quaternion()
    .setFromAxisAngle(new Vector3(0, 0, -1), 0.4)
    .multiply(restWorld);
  same(actualWorld, expectedWorld);
});

test('default sway is two seconds and an explicit zero amplitude preserves every rest key', () => {
  const bone = new Object3D();
  bone.rotation.set(0.2, 0.3, 0.4);
  assert.equal(windClip([bone]).duration, 2);
  const clip = windClip([bone], { angle: 0 });
  for (const time of clip.tracks[0].times) same(at(clip.tracks[0], time), bone.quaternion);
  assert.deepEqual(windClip([]).tracks, []);
});
