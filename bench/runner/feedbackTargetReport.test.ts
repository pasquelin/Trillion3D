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
  capture: file,
  gpuFrameMs: Array(12).fill(ms),
  gpuPassSamples: Array.from({ length: 12 }, (_, i) => sample(i, target)),
  residency: identity(),
  counters: {
    gpuFrameTargetBytes: 1000 + (target ? bytes : 0),
    pagesLoading: 0,
    coverageReady: true,
    selectedTriangles: 10,
    drawnTriangles: 10,
    textureTilesPending: 0,
    textureMissingLevels: 0,
    textureTilesRequested: 3,
    textureTilesAtLevel: 3,
  },
});
const region = (atLevel: number) => ({ pixels: 100, requested: 80, atLevel, mips: {} });
const result = (): FeedbackTargetResult => ({
  supported: true,
  reason: null,
  pose: null,
  convergence: {
    supported: true,
    reason: null,
    trace: [],
    captures: [{ frame: 20, file: 'final.rgba', final: true }],
    spatial: [
      { frame: 2, center: region(80), periphery: region(40) },
      { frame: 12, center: region(80), periphery: region(80) },
      { frame: 20, center: region(80), periphery: region(80) },
    ],
    centerBeforePeriphery: 2,
    peripheryAtLevel: 12,
  },
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
    ['final.rgba', { w: 1, h: 1, body: Buffer.from([1, 2, 3, 255]) }],
  ]);
const verdict = (raw: FeedbackTargetResult, images = captures()) =>
  summarizeFeedbackRun(raw, 'alpha-blend-mode-test', 'sol', images, []).beyondSpread;

test('A/B/A gain requires samples, parity, residency, mip order, bytes and low spread', () => {
  assert.equal(verdict(result()), true);
  const failures: ((raw: FeedbackTargetResult) => void)[] = [
    (raw) => (raw.readings[1].gpuFrameMs = [8]),
    (raw) => (raw.readings[1].gpuPassSamples = []),
    (raw) => (raw.readings[1].residency.tiles.sha256 = 'different'),
    (raw) => (raw.convergence!.supported = false),
    (raw) => (raw.convergence!.peripheryAtLevel = null),
    (raw) => (raw.readings[1].counters.gpuFrameTargetBytes = 123),
  ];
  for (const mutate of failures) {
    const raw = result();
    mutate(raw);
    assert.equal(verdict(raw), null);
  }
  const images = captures();
  images.set('b.rgba', { w: 1, h: 1, body: Buffer.from([2, 2, 3, 255]) });
  assert.equal(verdict(result(), images), null);
  const raw = result();
  raw.readings[2].gpuFrameMs = Array(12).fill(14);
  assert.equal(verdict(raw), false);
});

test('WebGPU null uncovered metric permits resident verdict and reports pass shares', () => {
  const summary = summarizeFeedbackRun(result(), 'alpha-blend-mode-test', 'sol', captures(), []);
  assert.equal(summary.beyondSpread, true);
  assert.equal(summary.readings[0].passFrameShare['Trillion3D material surfaces v1'], 0.2);
  assert.equal(summary.readings[0].passFrameShare['Trillion3D texture feedback reduce'], 0.02);
  assert.equal(summary.readings[1].passFrameShare['Trillion3D texture feedback reduce'], null);
});
