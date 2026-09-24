// A3 and A4: splitOccludersInto returns the radix-sort pages flat, and countUnoccluded projects
// through projectBoxesFlat with an epoch cache instead of a HizBounds allocated per page and
// per frame. Oracle: the reference from before batch A in `../../../../bench/oracles/browser/occlusion.ts`.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../host/graph/graph.fixture.ts';
import { buildHizPyramid, countUnoccluded, createHizCounts, type HizPage } from './hiz.ts';
import { splitOccludersInto } from './split.ts';
import {
  referenceCountUnoccluded,
  referenceSplitOccluders,
} from '../../../../bench/oracles/browser/occlusion.ts';
import { cameraAt } from '../../../../tests/fixtures/hiz.ts';
import { cameraMoteur } from '../camera/camera.fixture.ts';
import { DEPTH_CLEAR } from '../camera/depthConvention.ts';
import { asHostLibrary } from '../host/resources.ts';

function box(min: number[], max: number[], tag: number) {
  return { min, max, matrix: new G.Matrix4(), tag } as HizPage & { tag: number };
}

/** Splits `pages` with both implementations and asserts the same occluders and rest, by tag. */
function assertSplitAgrees(
  pages: (HizPage & { tag: number })[],
  cam: G.GraphCamera,
  viewport: [number, number],
) {
  const occluders: (HizPage & { tag: number })[] = [],
    rest: (HizPage & { tag: number })[] = [];
  splitOccludersInto(pages, cameraMoteur(cam), viewport, occluders, rest);
  const reference = referenceSplitOccluders(
    pages,
    asHostLibrary<Parameters<typeof referenceSplitOccluders>[1]>(cam),
    viewport,
  );
  assert.deepEqual(
    occluders.map((p) => p.tag),
    reference.occluders.map((p: { tag: number }) => p.tag),
  );
  assert.deepEqual(
    rest.map((p) => p.tag),
    reference.rest.map((p: { tag: number }) => p.tag),
  );
}

test('no page and a single page are handled without crashing, matching the reference', () => {
  const cam = cameraAt(),
    viewport: [number, number] = [64, 64];
  assertSplitAgrees([], cam, viewport);
  assertSplitAgrees([box([-1, -1, -1], [1, 1, 1], 0)], cam, viewport);
});

test('a box crossing the near plane never becomes an occluder, NaN and Infinity bounds included', () => {
  const cam = cameraAt(0.5, 0.1),
    viewport: [number, number] = [32, 32];
  const pages = [
    box([-5, -5, -5], [5, 5, 5], 0), // Straddles the camera: clips the near plane.
    box([-0.1, -0.1, -2], [0.1, 0.1, -2], 1),
    box([NaN, -0.1, -3], [0.1, 0.1, -3], 2), // Degenerate: NaN corner never compares as "in front".
    box([Infinity, -Infinity, -4], [Infinity, Infinity, -4], 3),
  ];
  assertSplitAgrees(pages, cam, viewport);
});

test('countUnoccluded on an empty pyramid-worthy cut matches the reference, epoch cache included', () => {
  const cam = cameraAt(),
    viewport: [number, number] = [48, 48];
  const depth = new Float32Array(48 * 48);
  depth.fill(0.3);
  // A background hole — far, zero — outside the small box's footprint, which stays rejected.
  depth[0] = DEPTH_CLEAR;
  const pyramid = buildHizPyramid(depth, 48, 48);
  const pages = [
    box([-0.05, -0.05, -3], [0.05, 0.05, -3], 0), // Small and far: expected to be rejected.
    box([-0.02, -0.02, 0.3], [0.02, 0.02, 0.3], 1), // Behind the camera: degenerate but never crashes.
    box([-10, -10, -3], [10, 10, -3], 2), // Oversized: too wide for the level-0 kernel.
  ];
  const countsOptimisee = createHizCounts();
  const kept = countUnoccluded(pages, pyramid, cameraMoteur(cam), viewport, countsOptimisee);
  const countsReference = {
    tested: 0,
    testedTriangles: 0,
    oversized: 0,
    oversizedTriangles: 0,
    rejected: 0,
    rejectedTriangles: 0,
  };
  const referenceKept = referenceCountUnoccluded(
    pages,
    pyramid,
    asHostLibrary<Parameters<typeof referenceCountUnoccluded>[2]>(cam),
    viewport,
    countsReference,
  );
  assert.deepEqual(
    kept.map((p: HizPage & { tag: number }) => p.tag),
    referenceKept.map((p: { tag: number }) => p.tag),
  );
  assert.deepEqual(countsOptimisee, countsReference);
});
