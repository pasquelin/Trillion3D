import assert from 'node:assert/strict';
import test from 'node:test';
import { createSceneTelemetry } from '../site/lessons/engine-scene/telemetry.ts';

// Observed frame diagnostics cannot stand in for a measured rAF interval.
test('automatic telemetry reports counters without invented FPS and stops its activity timer', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const nodes = new Map();
  const host = {
    querySelector(selector) {
      if (!nodes.has(selector)) nodes.set(selector, { textContent: '' });
      return nodes.get(selector);
    },
  };
  const copy = { unavailableMetric: 'Unavailable', idle: 'No recent frame' };
  const telemetry = createSceneTelemetry(host, copy, 'en');
  const metrics = { selectedTriangles: 12, drawnTriangles: 12, cpuFrameMs: 2, gpuFrameMs: null };
  telemetry.frame(metrics);
  assert.equal(nodes.get('[data-scene-drawn]').textContent, '12');
  assert.equal(nodes.get('[data-scene-fps]').textContent, 'Unavailable');
  assert.equal(nodes.get('[data-scene-gpu]').textContent, 'Unavailable');
  t.mock.timers.tick(250);
  assert.equal(nodes.get('[data-scene-fps]').textContent, 'No recent frame');
  telemetry.frame(metrics);
  telemetry.stop();
  t.mock.timers.tick(250);
  assert.equal(nodes.get('[data-scene-fps]').textContent, 'Unavailable');
});
