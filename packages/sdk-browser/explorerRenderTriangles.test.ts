// `metricsScratch.triangles` (contrat `FrameMetrics.triangles: number | null`) : quand ni le moteur
// (`totalSubmittedTriangles`) ni le renderer de l'hôte n'ont compté d'image, `createExplorerRender`
// doit publier `null`, jamais `0` — un zéro se lirait comme une image vide.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createExplorerRender } from './explorerRender.ts';
import type { RenderBackend } from './backendTypes.ts';
import type { FrameMetrics } from '../sdk-core/index.ts';

/** Un jeu minimal d'entrées pour `createExplorerRender` : dessin muet, diagnostic éteint, audit
 *  éteint (pas de `wgFrameAudit` dans l'URL de test). Seuls `directGpu` et le renderer varient. */
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

test('triangles reste null quand ni le moteur ni le renderer de l’hôte n’ont compté (chemin GPU direct)', () => {
  const { render, metricsScratch } = harness({ directGpu: true });
  render();
  assert.equal(metricsScratch.triangles, null, 'un zéro se lirait comme une image vide');
});

test('triangles reste null quand l’hôte n’a pas de renderer possédé, hors chemin GPU direct', () => {
  const { render, metricsScratch } = harness({ directGpu: false });
  render();
  assert.equal(metricsScratch.triangles, null);
});

test('triangles reprend le compte du renderer de l’hôte quand il dessine et que le moteur n’a rien soumis', () => {
  const { render, metricsScratch } = harness({ directGpu: false, renderer: { triangles: 4200 } });
  render();
  assert.equal(metricsScratch.triangles, 4200);
});

test('triangles ignore le renderer de l’hôte sur le chemin GPU direct, même s’il compte encore', () => {
  const { render, metricsScratch } = harness({ directGpu: true, renderer: { triangles: 4200 } });
  render();
  assert.equal(metricsScratch.triangles, null, 'le renderer possédé ne dessine rien en direct GPU');
});

test('triangles publie le total soumis du moteur dès qu’il existe, avant tout repli', () => {
  const { render, metricsScratch } = harness({ directGpu: false, renderer: { triangles: 999 } });
  (metricsScratch as unknown as { totalSubmittedTriangles: number }).totalSubmittedTriangles = 1234;
  render();
  assert.equal(metricsScratch.triangles, 1234);
});
