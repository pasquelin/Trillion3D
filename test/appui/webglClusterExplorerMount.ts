// The public exact-pages mount the explorer proofs share: a 64 × 64 host renderer on a WebGL2
// canvas, the backend of a prepared scene, the scene drawer, a comparison target, and a count
// of what the host pass is handed — what the engine owns must never reach it.
import * as THREE from 'three';
import type { BackendContext } from '../../packages/sdk-browser/backendTypes.ts';
import { exactPagesBackend } from '../../packages/sdk-browser/exactPagesBackend.ts';
import { createSceneDrawer } from '../../packages/sdk-browser/explorerDrawScene.ts';

/** Null without WebGL2. `inHostPass(object)` names the objects counted on each host render. */
export function mountExplorerProof(
  scene: Pick<BackendContext, 'source' | 'metadata' | 'indices' | 'associations'>,
  camera: THREE.PerspectiveCamera,
  inHostPass: (object: THREE.Object3D) => boolean,
  context: Partial<BackendContext> = {},
) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const gl = canvas.getContext('webgl2');
  if (!gl) return null;
  const host = new THREE.WebGLRenderer({ canvas, context: gl }),
    backend = exactPagesBackend({
      source: scene.source,
      metadata: scene.metadata,
      indices: scene.indices,
      associations: scene.associations,
      pixelError: 0,
      viewport: [64, 64],
      webglContext: gl,
      ...context,
    }),
    draw = createSceneDrawer(host, camera),
    target = new THREE.WebGLRenderTarget(64, 64),
    calls: { counted: number; children: number }[] = [];
  const originalRender = host.render.bind(host);
  host.render = (drawn: THREE.Object3D, view: THREE.Camera) => {
    let counted = 0;
    drawn.traverse((object) => {
      if (inHostPass(object)) counted++;
    });
    calls.push({ counted, children: drawn.children.length });
    return originalRender(drawn, view);
  };
  return {
    gl,
    host,
    backend,
    draw,
    target,
    calls,
    /** Objects the host pass was handed over the whole run. */
    get countedInHostPass() {
      return calls.reduce((sum, call) => sum + call.counted, 0);
    },
    dispose() {
      draw.dispose();
      backend.dispose();
      target.dispose();
      host.dispose();
    },
  };
}
