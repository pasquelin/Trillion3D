import * as THREE from 'three';
import type { HostDrawOutput } from './backendTypes.ts';
import type { HostCamera, HostDrawCamera } from './cameraWorld.ts';

/**
 * The witness adapter: the one Three renderer the witness engines share over the engine's
 * context, to draw the scenes they hold. The host never holds a renderer; a witness acquires
 * this one at its first draw and releases it at its dispose, and the renderer leaves with the
 * last of them. One per context, so that a texture or a program is uploaded once for every
 * witness of the session, as the host's own adapter did.
 *
 * Every draw starts from a reset state: the engine's programs and copies wrote the context in
 * between, and the renderer's cache no longer describes it. A render target of the engine is a
 * display surface the renderer does not own, exactly what its XR layer is to it: it is bound the
 * way the library's own XR manager binds that layer — `setRenderTargetFramebuffer` on a wrapper
 * flagged `isXRRenderTarget`, so that the output colour space and the tone mapping apply as on
 * the drawing buffer — and the wrapper is never allocated, resized or disposed by the renderer,
 * which would delete the engine's framebuffer. Neither entry point is in the library's type
 * declarations; both are what its XR manager calls.
 */
type Wrapper = THREE.WebGLRenderTarget & { isXRRenderTarget: boolean };
type Shared = { renderer: FramebufferRenderer; wrapper: Wrapper; users: number };
type FramebufferRenderer = THREE.WebGLRenderer & {
  setRenderTargetFramebuffer(target: Wrapper, framebuffer: WebGLFramebuffer): void;
};
const shared = new WeakMap<WebGL2RenderingContext, Shared>();

function acquire(gl: WebGL2RenderingContext) {
  let entry = shared.get(gl);
  if (!entry) {
    const renderer = new THREE.WebGLRenderer({
      canvas: gl.canvas as HTMLCanvasElement,
      context: gl,
    }) as FramebufferRenderer;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMappingExposure = 1;
    const wrapper = Object.assign(new THREE.WebGLRenderTarget(1, 1), { isXRRenderTarget: true });
    wrapper.texture.colorSpace = THREE.SRGBColorSpace;
    entry = { renderer, wrapper, users: 0 };
    shared.set(gl, entry);
  }
  entry.users++;
  return entry;
}

function release(gl: WebGL2RenderingContext, entry: Shared) {
  if (--entry.users > 0) return;
  shared.delete(gl);
  entry.renderer.dispose();
}

/**
 * `drawHostGeometry` of an engine whose image is a Three scene. `render(camera)` records the
 * host camera of the frame, the one the draw uses; `counters()` gives what the last draw
 * submitted, `null` before the first. Without a context (a session that never draws on the
 * host surface) the draw is refused by name.
 */
export function createThreeSceneDraw(gl: WebGL2RenderingContext | undefined, scene: THREE.Scene) {
  let entry: Shared | undefined,
    camera: HostCamera | undefined,
    counters: { calls: number; triangles: number } | null = null;
  return {
    render(hostCamera: HostCamera) {
      camera = hostCamera;
    },
    drawHostGeometry(_camera: HostDrawCamera, output: HostDrawOutput) {
      if (!gl) throw new Error('HOST_SURFACE_MISSING');
      if (!camera) throw new Error('Draw before render');
      entry ??= acquire(gl);
      const { renderer, wrapper } = entry;
      renderer.resetState();
      const tone = output.toneMapped ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
      if (renderer.toneMapping !== tone) renderer.toneMapping = tone;
      if (output.framebuffer) {
        renderer.setRenderTargetFramebuffer(wrapper, output.framebuffer);
        wrapper.viewport.set(0, 0, output.width, output.height);
        wrapper.scissor.set(0, 0, output.width, output.height);
        renderer.setRenderTarget(wrapper);
      } else {
        renderer.setViewport(0, 0, output.width, output.height);
        renderer.setRenderTarget(null);
      }
      // The host cleared the framebuffer with the scene's background: nothing to clear again.
      const autoClear = renderer.autoClear,
        background = scene.background;
      renderer.autoClear = false;
      scene.background = null;
      try {
        renderer.render(scene, camera);
      } finally {
        renderer.autoClear = autoClear;
        scene.background = background;
      }
      counters = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
    },
    counters: () => counters,
    dispose() {
      if (entry && gl) release(gl, entry);
      entry = undefined;
    },
  };
}
