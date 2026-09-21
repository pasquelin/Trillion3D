// The public exact-pages mount the explorer proofs share: a 64 × 64 WebGL2 canvas, the backend of
// a prepared scene, the frame composer, a comparison target, and a count of what the scene pass
// is handed — the scene the witness adapter draws after the owner, where what the engine owns
// must never appear.
import type * as THREE from 'three';
import { exactPagesBackend } from '../../packages/sdk-browser/exactPagesBackend.ts';
import { createFrameComposer } from '../../packages/sdk-browser/explorerCompose.ts';
import {
  bindWebglTarget,
  createWebglRenderTarget,
} from '../../packages/sdk-browser/webglRenderTarget.ts';
import { pixel } from './webglClusterPixels.ts';
import type { BackendContext } from '../../packages/sdk-browser/backendTypes.ts';
import type { HostCamera } from '../../packages/sdk-browser/cameraWorld.ts';

/** The prepared-scene fields every explorer proof's fixture shares. */
type ExplorerScene = Pick<BackendContext, 'source' | 'metadata' | 'indices' | 'associations'>;

/** Null without WebGL2. `inHostPass(object)` names the objects counted on each scene pass. */
export function mountExplorerProof(
  scene: ExplorerScene,
  camera: HostCamera,
  inHostPass: (object: THREE.Object3D) => boolean,
  context: Partial<BackendContext> = {},
) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const gl = canvas.getContext('webgl2');
  if (!gl) return null;
  const backend = exactPagesBackend({
      source: scene.source,
      metadata: scene.metadata,
      indices: scene.indices,
      associations: scene.associations,
      pixelError: 0,
      viewport: [64, 64],
      webglContext: gl,
      ...context,
    }),
    draw = createFrameComposer(gl, camera),
    target = createWebglRenderTarget(gl, 64, 64),
    calls: { counted: number; children: number }[] = [];
  const drawHostGeometry = backend.drawHostGeometry;
  if (!drawHostGeometry) throw new Error('exact pages backend must draw host geometry');
  backend.drawHostGeometry = (drawCamera, output) => {
    drawHostGeometry(drawCamera, output);
    let counted = 0;
    backend.scene.traverse((object) => {
      if (inHostPass(object)) counted++;
    });
    calls.push({ counted, children: backend.scene.children.length });
  };
  return {
    gl,
    backend,
    draw,
    target,
    calls,
    /** Objects the scene pass was handed over the whole run. */
    get countedInHostPass() {
      return calls.reduce((sum, call) => sum + call.counted, 0);
    },
    /** One pixel of the comparison target, read on its own framebuffer. */
    targetPixel(x: number, y: number) {
      bindWebglTarget(gl, target);
      const value = pixel(gl, x, y);
      bindWebglTarget(gl, null);
      return value;
    },
    dispose() {
      draw.dispose();
      backend.dispose();
      target.dispose();
    },
  };
}
