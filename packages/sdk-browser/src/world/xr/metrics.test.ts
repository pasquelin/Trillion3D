import test from 'node:test';
import assert from 'node:assert/strict';
import { xrFrameMetrics } from './metrics.ts';

test('stereo sums submitted work, counts shared pools once and refuses to label stale GPU timing as XR timing', () => {
  const left = {
    selectedTriangles: 100,
    cpuSelectNodesTested: 7,
    submittedTriangles: 90,
    totalSubmittedTriangles: 100,
    geometryPoolBytes: 1024,
    drawCalls: 3,
    frameHeld: true,
    coverageReady: true,
    gpuFrameMs: 8,
  };
  const right = {
    ...left,
    submittedTriangles: 80,
    totalSubmittedTriangles: 85,
    drawCalls: 2,
    frameHeld: false,
    gpuFrameMs: 11,
  };
  const metrics = xrFrameMetrics([left, right], 7);
  assert.equal(metrics.selectedTriangles, 100);
  assert.equal(metrics.cpuSelectNodesTested, 7);
  assert.equal(metrics.submittedTriangles, 170);
  assert.equal(metrics.totalSubmittedTriangles, 185);
  assert.equal(metrics.drawCalls, 5);
  assert.equal(metrics.geometryPoolBytes, 1024);
  assert.equal(metrics.frameHeld, false);
  assert.equal(metrics.coverageReady, true);
  assert.equal(metrics.gpuFrameMs, null);
  assert.equal(metrics.gpuPassMs, null);
  assert.equal(xrFrameMetrics([left, {}]).submittedTriangles, null);
  assert.equal(xrFrameMetrics([left, {}]).coverageReady, null);
});
