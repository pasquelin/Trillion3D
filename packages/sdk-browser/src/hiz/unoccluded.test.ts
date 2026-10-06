// The rules of the occlusion split and test: the occluder split is a partition that keeps the
// nearest half of the boxes in front of the eye, and the test never culls a box that could be
// seen, counts every box once, and keeps what it cannot prove hidden.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../host/graph/graph.fixture.ts';
import { createHizCounts, type HizCounts } from './counts.ts';
import type { HizPage } from './types.ts';
import { buildHizPyramid } from './depth.ts';
import { countUnoccluded, filterUnoccluded } from './unoccluded.ts';
import { splitOccludersInto } from './split.ts';
import {
  cameraAt,
  occluderPyramid,
  projectBoxToScreen,
  quad,
  seededRandom,
} from '../../../../tests/fixtures/hiz.ts';
import { cameraMoteur } from '../camera/camera.fixture.ts';
import { DEPTH_CLEAR } from '../camera/depthConvention.ts';
import { identityRoots } from '../page/selection/placements.fixture.ts';

type Tagged = HizPage & { tag: number; array?: ArrayLike<number> };

const box = (min: number[], max: number[], tag: number, triangles = 0): Tagged => ({
  min,
  max,
  tag,
  array: new Uint32Array(triangles * 3),
});

/** A box of the generated cut: somewhere in the view, from far behind the origin to near the eye. */
function randomBox(rand: () => number, tag: number) {
  const x = (rand() - 0.5) * 6,
    y = (rand() - 0.5) * 6,
    z = -8 + rand() * 12;
  const sx = 0.05 + rand() * 1.5,
    sy = 0.05 + rand() * 1.5,
    sz = rand() * 1.5;
  return box([x - sx, y - sy, z - sz], [x + sx, y + sy, z + sz], tag, 1 + Math.floor(rand() * 40));
}

function split(
  pages: Tagged[],
  cam = cameraMoteur(cameraAt()),
  viewport: [number, number] = [64, 64],
) {
  const occluders: Tagged[] = [],
    rest: Tagged[] = [];
  const count = splitOccludersInto(pages, identityRoots(), cam, viewport, occluders, rest);
  return { occluders, rest, count };
}

const bounds = (page: Tagged, cam = cameraAt(), viewport: [number, number] = [64, 64]) =>
  projectBoxToScreen(page.min, page.max, new G.Matrix4(), cam, viewport);

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

/** A full-screen occluder at the origin plane, seen from z = 5: everything behind it is hidden. */
function wall(size: [number, number]) {
  const material = G.basicSurface();
  const { page, geometry } = quad(material, [-6, -6, 0], [6, 6, 0], 'wall');
  const pyramid = occluderPyramid([page], cameraMoteur(cameraAt()), size);
  geometry.dispose();
  material.dispose();
  return pyramid;
}

test('a box behind a wall that covers the view is rejected, one in front of it is kept', () => {
  const size: [number, number] = [48, 48];
  const pyramid = wall(size);
  const pages = [
    box([-0.5, -0.5, -4], [0.5, 0.5, -3], 0, 10), // Behind the wall.
    box([-0.5, -0.5, 1], [0.5, 0.5, 2], 1, 20), // In front of it.
  ];
  const counts = createHizCounts();
  const kept = countUnoccluded(
    pages,
    identityRoots(),
    pyramid,
    cameraMoteur(cameraAt()),
    size,
    counts,
  );
  assert.deepEqual(
    kept.map((p) => p.tag),
    [1],
  );
  assert.equal(counts.tested, 2);
  assert.equal(counts.testedTriangles, 30);
  assert.equal(counts.rejected, 1);
  assert.equal(counts.rejectedTriangles, 10);
});

test('the test never culls a box that could be seen, over generated cuts and occluders', () => {
  const rand = seededRandom(31);
  const size: [number, number] = [40, 36];
  const cam = cameraMoteur(cameraAt());
  let rejected = 0;
  for (let round = 0; round < 30; round++) {
    // Random occluding quads: some pixels of the pyramid hold a depth, some stay background.
    const mats: G.GraphSurface[] = [],
      quads = [];
    for (let q = 0; q < 1 + Math.floor(rand() * 4); q++) {
      const material = G.basicSurface();
      mats.push(material);
      const cx = (rand() - 0.5) * 4,
        cy = (rand() - 0.5) * 4,
        h = 0.4 + rand() * 2.5,
        z = -4 + rand() * 7;
      quads.push(quad(material, [cx - h, cy - h, z], [cx + h, cy + h, z], `q${q}`));
    }
    const pyramid = occluderPyramid(
      quads.map((q) => q.page),
      cam,
      size,
    );
    const pages = Array.from({ length: 50 }, (_, i) => randomBox(rand, i));
    const counts = createHizCounts();
    const kept = new Set(
      countUnoccluded(pages, identityRoots(), pyramid, cam, size, counts).map((p) => p.tag),
    );
    for (const page of pages) {
      if (kept.has(page.tag)) continue;
      rejected++;
      // A rejected box is not crossing the near plane, and every texel its screen rectangle
      // can paint holds a surface strictly nearer than the box's nearest point.
      const b = bounds(page, cameraAt(), size);
      assert.equal(b.clipsNear, false);
      const x0 = Math.max(0, b.minX),
        y0 = Math.max(0, b.minY),
        x1 = Math.min(size[0] - 1, b.maxX),
        y1 = Math.min(size[1] - 1, b.maxY);
      assert.ok(x1 >= x0 && y1 >= y0, `box ${page.tag} reaches no pixel`);
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++)
          assert.ok(
            pyramid.data[y * size[0] + x] > b.nearestDepth,
            `box ${page.tag} rejected over a texel not nearer than it`,
          );
    }
    assert.equal(counts.tested, pages.length);
    assert.equal(counts.rejected, pages.length - kept.size);
    for (const q of quads) q.geometry.dispose();
    for (const m of mats) m.dispose();
  }
  assert.ok(rejected > 20, 'the generator hides enough boxes to prove something');
});

test('nothing is rejected over an empty pyramid, a near-plane crossing or a box with no extent', () => {
  const size: [number, number] = [32, 32];
  const cam = cameraMoteur(cameraAt(0.5, 0.1));
  const empty = buildHizPyramid(new Float32Array(32 * 32).fill(DEPTH_CLEAR), 32, 32);
  const pages = [
    box([-0.4, -0.4, -3], [0.4, 0.4, -3], 0),
    box([-5, -5, -5], [5, 5, 5], 1),
    box([NaN, 0, -3], [0, 0, -3], 2),
  ];
  const kept = countUnoccluded(pages, identityRoots(), empty, cam, size, createHizCounts());
  assert.equal(kept.length, pages.length);
  // A wall in front: still no page that clips the near plane or has a NaN bound is rejected.
  const solid = buildHizPyramid(new Float32Array(32 * 32).fill(0.9), 32, 32);
  const rejected = new Set(
    pages
      .filter(
        (p) => !countUnoccluded([p], identityRoots(), solid, cam, size, createHizCounts()).length,
      )
      .map((p) => p.tag),
  );
  assert.equal(rejected.has(1), false);
  assert.equal(rejected.has(2), false);
});

test('a page whose surface is never culled is kept behind a wall, and the ranks of the kept are given', () => {
  const size: [number, number] = [48, 48];
  const pyramid = wall(size);
  const behind = (tag: number, material?: HizPage['material']): Tagged => ({
    ...box([-0.5, -0.5, -4], [0.5, 0.5, -3], tag, 5),
    material,
  });
  const pages = [
    behind(0),
    behind(1, { sprite: { sizeAttenuation: false } } as HizPage['material']),
    behind(2),
  ];
  const ranks: number[] = [];
  const counts: HizCounts = createHizCounts();
  const kept = countUnoccluded(
    pages,
    identityRoots(),
    pyramid,
    cameraMoteur(cameraAt()),
    size,
    counts,
    ranks,
  );
  assert.deepEqual(
    kept.map((p) => p.tag),
    [1],
  );
  assert.deepEqual(ranks, [1]);
  assert.equal(counts.rejected, 2);
  const filtered = filterUnoccluded(
    pages,
    identityRoots(),
    pyramid,
    cameraMoteur(cameraAt()),
    size,
  );
  assert.deepEqual(
    filtered.map((p) => p.tag),
    [1],
  );
});

test('a bias keeps what the wall hides by less than the bias, and the counts add up', () => {
  const size: [number, number] = [48, 48];
  const pyramid = wall(size);
  const cam = cameraMoteur(cameraAt());
  // A box a hair behind the wall: hidden with no bias, kept once the bias exceeds the gap.
  const page = box([-0.5, -0.5, -0.01], [0.5, 0.5, -0.01], 0, 4);
  assert.equal(filterUnoccluded([page], identityRoots(), pyramid, cam, size).length, 0);
  assert.equal(
    filterUnoccluded([page], identityRoots(), pyramid, cam, size, undefined, 0.5).length,
    1,
  );
  const rand = seededRandom(3);
  const pages = Array.from({ length: 80 }, (_, i) => randomBox(rand, i));
  const counts = createHizCounts();
  const kept = countUnoccluded(pages, identityRoots(), pyramid, cam, size, counts);
  assert.equal(counts.tested, 80);
  assert.equal(counts.tested - counts.rejected, kept.length);
  assert.ok(counts.oversized <= counts.tested);
  assert.ok(counts.rejectedTriangles <= counts.testedTriangles);
});
