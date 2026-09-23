// `metricsScratch.triangles` (`FrameMetrics.triangles: number | null` contract): the engine's
// own count of the frame, `totalSubmittedTriangles`, and nothing else — the host draws nothing
// and counts nothing. When the engine has not counted, `createExplorerRender` must publish
// `null`, never `0` — a zero would read as an empty frame.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createExplorerRender } from './render.ts';
import { createDiagnosticChannel } from '../../diagnostic/channel.ts';
import type { RenderBackend } from '../../backend/types.ts';
import type { FrameMetrics } from '../../../../sdk-core/src/index.ts';

/** A minimal set of inputs for `createExplorerRender`: mute draw, diagnostic off, audit
 *  off (no `trillion3dFrameAudit` in the test URL). Only `directGpu` and the engine count vary. */
function harness(options: { directGpu: boolean; counted?: number | null }) {
  const active = { id: 'test-backend' } as unknown as RenderBackend;
  const metricsScratch = { drawCalls: 0, totalSubmittedTriangles: null } as unknown as FrameMetrics;
  const session = {
    scope: 'full' as const,
    diagnosticChannel: createDiagnosticChannel(undefined, { enabled: false }),
    emit: () => {},
    diagnose: () => {},
  };
  const render = createExplorerRender(session, {
    check: () => {},
    state: {
      measuring: false,
      diagnostic: 'beauty',
      comparisonLayout: 'single',
      comparisonPair: ['a', 'b'],
      wipe: 0.5,
      toggle: 0,
      hostFrame: 0,
      active,
    } as never,
    camera: {} as never,
    lookAtTarget: { x: 0, y: 0, z: 0 },
    setPose: () => {},
    streaming: { arrivals: { drain: () => {} } } as never,
    drawBackend: () => {},
    ensureTarget: ((target?: unknown) => target) as never,
    directGpu: options.directGpu,
    backends: [active],
    baseline: active,
    fillMetrics: () => {
      metricsScratch.totalSubmittedTriangles = options.counted ?? null;
    },
    metricsScratch,
    profiler: { record: () => {} } as never,
    pageIdByUrl: new Map(),
    streamer: { stats: () => ({ resident: 0, evictions: 0 }) } as never,
    compose: Object.assign(() => {}, { dispose() {} }),
  });
  return { render, metricsScratch };
}

test('triangles stays null when the engine has not counted (direct GPU path)', () => {
  const { render, metricsScratch } = harness({ directGpu: true });
  render();
  assert.equal(metricsScratch.triangles, null, 'a zero would read as an empty frame');
});

test('triangles stays null when the engine has not counted, off the direct GPU path', () => {
  const { render, metricsScratch } = harness({ directGpu: false });
  render();
  assert.equal(metricsScratch.triangles, null);
});

test('triangles publishes the engine submitted total as soon as it exists', () => {
  for (const directGpu of [false, true]) {
    const { render, metricsScratch } = harness({ directGpu, counted: 1234 });
    render();
    assert.equal(metricsScratch.triangles, 1234);
  }
});
