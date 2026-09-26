// `metricsScratch.triangles` (`FrameMetrics.triangles: number | null` contract): the engine's
// own count of the frame, `totalSubmittedTriangles`, and nothing else — the host draws nothing
// and counts nothing. When the engine has not counted, `createExplorerRender` must publish
// `null`, never `0` — a zero would read as an empty frame.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createExplorerRender } from './render.ts';
import { createFrameBudget } from '../../page/integration/frameBudget.ts';
import { createDiagnosticChannel } from '../../diagnostic/channel.ts';
import type { RenderBackend } from '../../backend/types.ts';
import type { FrameMetrics } from '../../../../sdk-core/src/index.ts';

/** A minimal set of inputs for `createExplorerRender`: mute draw, diagnostic off, audit
 *  off (no `trillion3dFrameAudit` in the test URL). Only `directGpu` and the engine count vary. */
function harness(options: {
  directGpu: boolean;
  counted?: number | null;
  order?: string[];
  fails?: boolean;
}) {
  const note = (step: string) => void options.order?.push(step);
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
    followCells: null,
    guides: { follow: () => options.order?.push('follow') },
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
    streaming: {
      arrivals: { drain: () => (note('drain'), options.fails && assert.fail()) },
    } as never,
    frameBudget: {
      ...createFrameBudget(Infinity),
      open: () => (note('open'), 0),
      pause: () => note('pause'),
    },
    drawBackend: () => options.order?.push('draw'),
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
    compose: Object.assign(() => {}, { dispose() {}, effectBytes: () => 0 }),
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

// #264: the guides that follow a node are moved once per frame, before it draws. #404: the frame's
// one budget runs around its integration only, and stops before the engine draws, on every path.
test('each frame moves the followed guides once, and integrates within its budget, before it draws', () => {
  const order: string[] = [];
  const { render } = harness({ directGpu: false, order });
  render();
  assert.deepEqual(order, ['follow', 'open', 'drain', 'pause', 'draw']);
  order.length = 0;
  assert.throws(harness({ directGpu: false, order, fails: true }).render);
  assert.deepEqual(order, ['follow', 'open', 'drain', 'pause'], 'a drain that throws still pauses');
});
