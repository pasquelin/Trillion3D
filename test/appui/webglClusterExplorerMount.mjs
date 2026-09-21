// The public exact-pages mount the explorer proofs share: a 64 × 64 WebGL2 canvas, the backend of
// a prepared scene, the frame composer, a comparison target, and a count of what the scene pass
// is handed — the scene the witness adapter draws after the owner, where what the engine owns
// must never appear.
import { exactPagesBackend } from '../../packages/sdk-browser/exactPagesBackend.ts';
import { createFrameComposer } from '../../packages/sdk-browser/explorerCompose.ts';
import { createWebglRenderTarget } from '../../packages/sdk-browser/webglRenderTarget.ts';

/** Null without WebGL2. `inHostPass(object)` names the objects counted on each scene pass. */
export function mountExplorerProof(scene, camera, inHostPass, context = {}) {
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
    // A raw target: what the engine writes into it is read back as it was written.
    target = createWebglRenderTarget(gl, 64, 64),
    calls = [];
  const drawHostGeometry = backend.drawHostGeometry;
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
    targetPixel(x, y) {
      const value = new Uint8Array(4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, value);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return [...value];
    },
    dispose() {
      draw.dispose();
      backend.dispose();
      target.dispose();
    },
  };
}
