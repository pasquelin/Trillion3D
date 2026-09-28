import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summarizeFeedbackRun } from './feedbackTargetReport.ts';
import type { FeedbackTargetResult } from './feedbackTargetPage.ts';
import type { Capture } from '../../tests/kit/server/staticServer.ts';

const bytes = 2496 * 1404 * 4;
const sample = (frame: number, target: boolean) => ({
  frame,
  totalMs: 5,
  truncated: false,
  passes: [
    { name: 'Trillion3D material surfaces v1', gpuMs: 2 },
    { name: 'Trillion3D transparents', gpuMs: 1 },
    ...(target ? [{ name: 'Trillion3D texture feedback reduce', gpuMs: 0.2 }] : []),
  ],
});
const identity = () => ({
  geometry: { count: 2, sha256: 'same-pages' },
  tiles: { count: 3, sha256: 'same-tiles' },
});
const reading = (target: boolean, file: string, ms: number) => ({
  target,
  frames: 120,
  capture: file,
  gpuFrameMs: Array(12).fill(ms),
  gpuPassSamples: Array.from({ length: 12 }, (_, i) => sample(i, target)),
  residency: identity(),
  counters: {
    gpuFrameTargetBytes: 1000 + (target ? bytes : 0),
    residentPages: 2,
    pagesLoading: 0,
    uncoveredTriangles: 0,
    textureTilesResident: 3,
    textureTilesPending: 0,
    textureMissingLevels: 0,
    textureTilesRequested: 3,
    textureTilesAtLevel: 3,
  },
});
const result = (): FeedbackTargetResult => ({
  supported: true,
  reason: null,
  pose: null,
  convergence: {
    supported: true,
    reason: null,
    trace: [],
    captures: [
      { frame: 2, file: 'gap.rgba', final: false },
      { frame: 20, file: 'final.rgba', final: true },
    ],
  },
  size: { width: 2496, height: 1404 },
  readings: [
    reading(true, 'a1.rgba', 10),
    reading(false, 'b.rgba', 8),
    reading(true, 'a2.rgba', 10.2),
  ],
});
const captures = () =>
  new Map<string, Capture>([
    ['a1.rgba', { w: 1, h: 1, body: Buffer.from([1, 2, 3, 255]) }],
    ['b.rgba', { w: 1, h: 1, body: Buffer.from([1, 2, 3, 255]) }],
    ['a2.rgba', { w: 1, h: 1, body: Buffer.from([1, 2, 3, 255]) }],
    ['gap.rgba', { w: 1, h: 1, body: Buffer.from([2, 2, 3, 255]) }],
    ['final.rgba', { w: 1, h: 1, body: Buffer.from([1, 2, 3, 255]) }],
  ]);

test('A/B/A gain requires twelve samples, image parity and stable residency keys', () => {
  const raw = result();
  const images = captures();
  assert.equal(
    summarizeFeedbackRun(raw, 'alpha-blend-mode-test', 'sol', images, []).beyondSpread,
    true,
  );
  raw.readings[1].gpuFrameMs = [8];
  assert.equal(
    summarizeFeedbackRun(raw, 'alpha-blend-mode-test', 'sol', images, []).beyondSpread,
    null,
  );
  raw.readings[1].gpuFrameMs = Array(12).fill(8);
  raw.readings[1].residency.tiles.sha256 = 'different-tiles';
  assert.equal(
    summarizeFeedbackRun(raw, 'alpha-blend-mode-test', 'sol', images, []).beyondSpread,
    null,
  );
  raw.readings[1].residency.tiles.sha256 = 'same-tiles';
  images.set('b.rgba', { w: 1, h: 1, body: Buffer.from([2, 2, 3, 255]) });
  assert.equal(
    summarizeFeedbackRun(raw, 'alpha-blend-mode-test', 'sol', images, []).beyondSpread,
    null,
  );
  images.set('b.rgba', { w: 1, h: 1, body: Buffer.from([1, 2, 3, 255]) });
  images.set('gap.rgba', { w: 1, h: 1, body: Buffer.from([1, 2, 3, 255]) });
  assert.equal(
    summarizeFeedbackRun(raw, 'alpha-blend-mode-test', 'sol', images, []).beyondSpread,
    null,
  );
  raw.readings[1].counters.gpuFrameTargetBytes = 123;
  assert.equal(
    summarizeFeedbackRun(raw, 'alpha-blend-mode-test', 'sol', captures(), []).beyondSpread,
    null,
  );
});

test('A/A spread and convergence evidence can withhold a gain', () => {
  const raw = result();
  raw.readings[2].gpuFrameMs = Array(12).fill(14);
  assert.equal(
    summarizeFeedbackRun(raw, 'alpha-blend-mode-test', 'sol', captures(), []).beyondSpread,
    false,
  );
  raw.convergence!.supported = false;
  assert.equal(
    summarizeFeedbackRun(raw, 'alpha-blend-mode-test', 'sol', captures(), []).beyondSpread,
    null,
  );
});
