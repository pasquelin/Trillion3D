// The rules of the occluder split: a partition that keeps the nearest half of the boxes in front
// of the eye, and never makes an occluder of a box crossing the near plane.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraAt, seededRandom } from '../../../../tests/fixtures/hiz.ts';
import { cameraMoteur } from '../camera/camera.fixture.ts';
import { bounds, box, randomBox, split } from './occlusionCuts.fixture.ts';

test('no page splits into nothing, a single page in front is its own occluder', () => {
  assert.deepEqual(split([]), { occluders: [], rest: [], count: 0 });
  const only = box([-1, -1, -1], [1, 1, 1], 0);
  const got = split([only]);
  assert.deepEqual(got.occluders, [only]);
  assert.deepEqual(got.rest, []);
});

test('a box crossing the near plane never becomes an occluder, NaN and Infinity bounds included', () => {
  const cam = cameraMoteur(cameraAt(0.5, 0.1));
  const pages = [
    box([-5, -5, -5], [5, 5, 5], 0), // Straddles the camera: clips the near plane.
    box([-0.1, -0.1, -2], [0.1, 0.1, -2], 1),
    box([NaN, -0.1, -3], [0.1, 0.1, -3], 2),
    box([Infinity, -Infinity, -4], [Infinity, Infinity, -4], 3),
  ];
  const { occluders, rest } = split(pages, cam, [32, 32]);
  assert.equal(
    occluders.some((p) => p.tag === 0 || p.tag === 2 || p.tag === 3),
    false,
  );
  assert.equal(occluders.length + rest.length, pages.length);
  assert.ok(rest.some((p) => p.tag === 0));
});

test('the split is a partition: the nearest half of the boxes in front, the near clippers last', () => {
  const rand = seededRandom(7);
  for (let round = 0; round < 60; round++) {
    const pages = Array.from({ length: 1 + Math.floor(rand() * 40) }, (_, i) => randomBox(rand, i));
    const { occluders, rest, count } = split(pages);
    // Every page lands in exactly one of the two lists.
    assert.deepEqual(
      [...occluders, ...rest].map((p) => p.tag).sort((a, b) => a - b),
      pages.map((p) => p.tag),
    );
    const info = new Map(pages.map((p) => [p.tag, bounds(p)]));
    const inFront = pages.filter((p) => !info.get(p.tag)!.clipsNear);
    assert.equal(count, occluders.length);
    assert.equal(
      occluders.length,
      inFront.length ? Math.max(1, Math.floor(inFront.length / 2)) : 0,
    );
    // Occluders are in front of the eye and at least as near as every page left in front.
    for (const o of occluders) assert.equal(info.get(o.tag)!.clipsNear, false);
    const restInFront = rest.filter((p) => !info.get(p.tag)!.clipsNear);
    for (const o of occluders)
      for (const r of restInFront)
        assert.ok(info.get(o.tag)!.nearestDepth >= info.get(r.tag)!.nearestDepth);
    // Occluders come nearest first (ties by candidate order).
    for (let i = 1; i < occluders.length; i++)
      assert.ok(
        info.get(occluders[i - 1].tag)!.nearestDepth >= info.get(occluders[i].tag)!.nearestDepth,
      );
    // The near clippers follow every page in front.
    const firstClipper = rest.findIndex((p) => info.get(p.tag)!.clipsNear);
    if (firstClipper >= 0)
      for (const p of rest.slice(firstClipper)) assert.equal(info.get(p.tag)!.clipsNear, true);
  }
});
