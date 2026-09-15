// A3 et A4 : splitOccludersInto rend les pages du tri radix flat, et countUnoccluded projette par
// projectBoxesFlat avec cache d'époque au lieu d'un HizBounds alloué par page et par image. Oracle :
// la référence d'avant le lot A dans `scripts/mesure/calculs/oracles/occlusion.mjs`.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildHizPyramid, countUnoccluded, createHizCounts, type HizPage } from './hiz.ts';
import { splitOccludersInto } from './hizSplit.ts';
import {
  referenceCountUnoccluded,
  referenceSplitOccluders,
} from '../../scripts/mesure/calculs/oracles/occlusion.mjs';
import { cameraAt } from '../../test/fixtures/hiz.ts';

function box(min: number[], max: number[], tag: number) {
  return { min, max, matrix: new THREE.Matrix4(), tag } as HizPage & { tag: number };
}

/** Splits `pages` with both implementations and asserts the same occluders and rest, by tag. */
function assertSplitAgrees(
  pages: (HizPage & { tag: number })[],
  cam: THREE.PerspectiveCamera,
  viewport: [number, number],
) {
  const occluders: (HizPage & { tag: number })[] = [],
    rest: (HizPage & { tag: number })[] = [];
  splitOccludersInto(pages, cam, viewport, occluders, rest);
  const reference = referenceSplitOccluders(pages, cam, viewport);
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
  depth[24 * 48 + 24] = 1; // A hole that must keep whatever falls behind it.
  const pyramid = buildHizPyramid(depth, 48, 48);
  const pages = [
    box([-0.05, -0.05, -3], [0.05, 0.05, -3], 0), // Small and far: expected to be rejected.
    box([-0.02, -0.02, 0.3], [0.02, 0.02, 0.3], 1), // Behind the camera: degenerate but never crashes.
    box([-10, -10, -3], [10, 10, -3], 2), // Oversized: too wide for the level-0 kernel.
  ];
  const countsOptimisee = createHizCounts();
  const kept = countUnoccluded(pages, pyramid, cam, viewport, countsOptimisee);
  const countsReference = {
    tested: 0,
    testedTriangles: 0,
    oversized: 0,
    oversizedTriangles: 0,
    rejected: 0,
    rejectedTriangles: 0,
  };
  const referenceKept = referenceCountUnoccluded(pages, pyramid, cam, viewport, countsReference);
  assert.deepEqual(
    kept.map((p: HizPage & { tag: number }) => p.tag),
    referenceKept.map((p: { tag: number }) => p.tag),
  );
  assert.deepEqual(countsOptimisee, countsReference);
});
