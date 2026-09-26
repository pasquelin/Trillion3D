// `metricsScratch.triangles` (`FrameMetrics.triangles: number | null` contract): the engine's
// own count of the frame, `totalSubmittedTriangles`, and nothing else — the host draws nothing
// and counts nothing. When the engine has not counted, `createExplorerRender` must publish
// `null`, never `0` — a zero would read as an empty frame.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createExplorerRender } from './render.ts';
import { createFrameBudget, type FrameClock } from '../../page/integration/frameBudget.ts';
import { createDiagnosticChannel } from '../../diagnostic/channel.ts';
import type { RenderBackend } from '../../backend/types.ts';
import type { FrameMetrics } from '../../../../sdk-core/src/index.ts';

/** A minimal set of inputs for `createExplorerRender`: mute draw, diagnostic off, audit
 *  off (no `trillion3dFrameAudit` in the test URL). Only `directGpu` and the engine count vary. */
function harness(options: {
  directGpu: boolean;
  counted?: number | null;
  order?: string[];
  frameBudget?: FrameClock;
  drain?: () => void;
}) {
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
    streaming: { arrivals: { drain: options.drain ?? (() => {}) } } as never,
    frameBudget: options.frameBudget ?? createFrameBudget(Infinity),
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

// #264: the guides that follow a node are moved once per frame, before it draws.
test('each frame moves the followed guides once, before it draws', () => {
  const order: string[] = [];
  const { render } = harness({ directGpu: false, order });
  render();
  render();
  assert.deepEqual(order, ['follow', 'draw', 'follow', 'draw']);
});

// #404: the frame's one budget runs while it integrates, and stops before the engine draws — whose
// row records resume it —, on every path.
test('a frame runs its integration budget around the arrivals only, and stops it even on a throw', () => {
  const order: string[] = [];
  const budget = createFrameBudget(Infinity);
  const frameBudget = {
    ...budget,
    open: () => (order.push('open'), budget.open()),
    pause: () => void (order.push('pause'), budget.pause()),
  };
  const { render } = harness({
    directGpu: false,
    order,
    frameBudget,
    drain: () => order.push('drain'),
  });
  render();
  assert.deepEqual(order, ['follow', 'open', 'drain', 'pause', 'draw']);
  order.length = 0;
  const failing = harness({
    directGpu: false,
    order,
    frameBudget,
    drain: () => assert.fail('drain'),
  });
  assert.throws(() => failing.render());
  assert.deepEqual(order, ['follow', 'open', 'pause']);
});
