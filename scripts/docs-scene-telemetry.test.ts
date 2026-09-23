import assert from 'node:assert/strict';
import test from 'node:test';
import { createSceneTelemetry } from '../site/lessons/engine-scene/telemetry.ts';
import { sceneCopy } from '../site/lessons/engine-scene/content.ts';
import type { FrameMetrics, World } from '../packages/sdk-browser/src/index.ts';

// `telemetry.frame` only reads `world.budget`; cast at this boundary rather than modelling the
// whole `World` surface.
const world = {
  budget: { geometryPool: 4 * 1024 * 1024, geometryPoolCeiling: 16 * 1024 * 1024, texturePool: 0 },
} as unknown as World;

// Every field `FrameMetrics` requires; the fields this test cares about are overridden below.
const baseMetrics: FrameMetrics = {
  rafIntervalMs: null,
  cpuFrameMs: 0,
  cpuSubmitMs: null,
  gpuMs: null,
  drawCalls: null,
  triangles: null,
  clusters: null,
  selectedTriangles: null,
  residentPages: null,
  geometryAllocationBytes: null,
  vramBytes: null,
  pageLoads: 0,
  pageBytesRead: 0,
};

// Observed frame diagnostics cannot stand in for a measured rAF interval.
test('automatic telemetry reports counters without invented FPS and stops its activity timer', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  type Node = {
    textContent: string;
    held?: boolean;
    toggleAttribute(name: string, on: boolean): void;
  };
  const nodes = new Map<string, Node>();
  const host = {
    querySelector(selector: string) {
      if (!nodes.has(selector))
        nodes.set(selector, {
          textContent: '',
          toggleAttribute(name, on) {
            if (name === 'data-scene-held') this.held = on;
          },
        });
      return nodes.get(selector);
    },
    // `telemetry.frame` only calls `querySelector`; cast at this boundary rather than
    // modelling the whole `ParentNode` DOM surface.
  } as ParentNode;
  const copy = { ...sceneCopy.en, unavailableMetric: 'Unavailable', idle: 'No recent frame' };
  const telemetry = createSceneTelemetry(host, copy, 'en');
  const metrics: FrameMetrics = {
    ...baseMetrics,
    selectedTriangles: 12,
    drawnTriangles: 9,
    geometryAllocationBytes: 2 * 1024 * 1024,
    textureResidentBytes: 3 * 1024 * 1024,
    cpuFrameMs: 2,
    gpuFrameMs: null,
  };
  const textOf = (selector: string) => {
    const node = nodes.get(selector);
    assert.ok(node, selector);
    return node.textContent;
  };
  telemetry.frame(world, metrics);
  assert.equal(textOf('[data-scene-selected]'), '12');
  assert.equal(textOf('[data-scene-drawn]'), '9', 'drawn reads drawnTriangles, not selected again');
  assert.equal(textOf('[data-scene-fps]'), 'Unavailable');
  assert.equal(textOf('[data-scene-gpu]'), 'Unavailable');
  assert.equal(textOf('[data-scene-geometry-memory]'), '2.0 MiB', 'resident geometry bytes');
  assert.equal(textOf('[data-scene-texture-memory]'), '3.0 MiB', 'resident texture bytes');
  t.mock.timers.tick(250);
  assert.equal(textOf('[data-scene-fps]'), 'No recent frame');
  assert.equal(nodes.get('[data-scene-fps]')?.held, false, 'a drawn frame is not a held one');
  telemetry.frame(world, { ...metrics, frameHeld: true });
  assert.equal(nodes.get('[data-scene-fps]')?.held, true, 'the engine says the image is final');
  telemetry.stop();
  t.mock.timers.tick(250);
  assert.equal(textOf('[data-scene-fps]'), 'Unavailable');
});
