// `metricsScratch.triangles` (contrat `FrameMetrics.triangles: number | null`) : quand ni le moteur
// (`totalSubmittedTriangles`) nor the host renderer have counted a frame, `createExplorerRender`
// must publish `null`, never `0` — a zero would read as an empty frame.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createExplorerRender } from './explorerRender.ts';
import type { RenderBackend } from './backendTypes.ts';
import type { FrameMetrics } from '../sdk-core/index.ts';

/** A minimal set of inputs for `createExplorerRender`: mute draw, diagnostic off, audit
 *  off (no `wgFrameAudit` in the test URL). Only `directGpu` and the renderer vary. */
function harness(options: { directGpu: boolean; renderer?: { triangles: number } }) {
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 50);
  const active = { id: 'test-backend' } as unknown as RenderBackend;
  const metricsScratch = { drawCalls: 0, totalSubmittedTriangles: null } as unknown as FrameMetrics;
  const session = {
    scope: 'default' as never,
    diagnosticChannel: { enabled: false } as never,
    emit: () => {},
    diagnose: () => {},
  };
  const ownedRenderer = options.renderer
    ? ({
        info: { render: { triangles: options.renderer.triangles, calls: 0 } },
      } as unknown as THREE.WebGLRenderer)
    : (undefined as unknown as THREE.WebGLRenderer);
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
    camera,
    lookAtTarget: new THREE.Vector3(),
    setPose: () => {},
    streaming: { arrivals: { drain: () => {} } } as never,
    drawBackend: () => {},
    ensureTarget: ((target?: THREE.WebGLRenderTarget) => target) as never,
    directGpu: options.directGpu,
    renderer: ownedRenderer,
    backends: [active],
    baseline: active,
    fillMetrics: () => {},
    metricsScratch,
    profiler: { record: () => {} } as never,
    pageIdByUrl: new Map(),
    streamer: { stats: () => ({ resident: 0, evictions: 0 }) } as never,
  });
  return { render, metricsScratch };
}

test('triangles stays null when neither the engine nor the host renderer has counted (direct GPU path)', () => {
  const { render, metricsScratch } = harness({ directGpu: true });
  render();
  assert.equal(metricsScratch.triangles, null, 'a zero would read as an empty frame');
});

test('triangles stays null when the host has no owned renderer, off the direct GPU path', () => {
  const { render, metricsScratch } = harness({ directGpu: false });
  render();
  assert.equal(metricsScratch.triangles, null);
});

test('triangles takes the host renderer count when it draws and the engine has submitted nothing', () => {
  const { render, metricsScratch } = harness({ directGpu: false, renderer: { triangles: 4200 } });
  render();
  assert.equal(metricsScratch.triangles, 4200);
});

test('triangles ignores the host renderer on the direct GPU path, even if it still counts', () => {
  const { render, metricsScratch } = harness({ directGpu: true, renderer: { triangles: 4200 } });
  render();
  assert.equal(metricsScratch.triangles, null, 'the owned renderer draws nothing on direct GPU');
});

test('triangles publishes the engine submitted total as soon as it exists, before any fallback', () => {
  const { render, metricsScratch } = harness({ directGpu: false, renderer: { triangles: 999 } });
  (metricsScratch as unknown as { totalSubmittedTriangles: number }).totalSubmittedTriangles = 1234;
  render();
  assert.equal(metricsScratch.triangles, 1234);
});
