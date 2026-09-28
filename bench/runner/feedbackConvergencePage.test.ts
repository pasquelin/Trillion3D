import assert from 'node:assert/strict';
import { test } from 'node:test';
import { feedbackGeometryReady, type ConvergenceFrame } from './feedbackConvergencePage.ts';

const frame = {
  coverageReady: true,
  selected: 10,
  drawn: 10,
  pagesLoading: 0,
  uncovered: null,
} as ConvergenceFrame;

test('WebGPU null uncovered count can still prove submitted geometry coverage', () => {
  assert.equal(feedbackGeometryReady(frame), true);
  assert.equal(feedbackGeometryReady({ ...frame, coverageReady: false }), false);
  assert.equal(feedbackGeometryReady({ ...frame, selected: 11 }), false);
  assert.equal(feedbackGeometryReady({ ...frame, pagesLoading: 1 }), false);
});
