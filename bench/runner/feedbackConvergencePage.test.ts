import assert from 'node:assert/strict';
import { test } from 'node:test';
import { feedbackGeometryReady, type ConvergenceFrame } from './feedbackConvergencePage.ts';

const frame: ConvergenceFrame = {
  frame: 4,
  held: false,
  coverageReady: true,
  selected: 10,
  drawn: 10,
  uncovered: null,
  pagesLoading: 0,
  residentPages: 3,
  shadowPagesPending: 0,
  shadowPagesDrawn: 0,
  requested: 5,
  atLevel: 2,
  served: 2,
  pending: 3,
  deferred: 0,
  missingLevels: 3,
  refused: 0,
};

test('WebGPU null uncovered count can still prove submitted geometry coverage', () => {
  assert.equal(feedbackGeometryReady(frame), true);
  assert.equal(feedbackGeometryReady({ ...frame, coverageReady: false }), false);
  assert.equal(feedbackGeometryReady({ ...frame, selected: 11 }), false);
  assert.equal(feedbackGeometryReady({ ...frame, pagesLoading: 1 }), false);
});
