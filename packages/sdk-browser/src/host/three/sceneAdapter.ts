import * as THREE from 'three';
import type { HostDrawOutput } from '../../backend/types.ts';
import {
  DEFAULT_TONE_MAPPING,
  type SceneToneMapping,
} from '../../../../sdk-core/src/scene/core/environment.ts';
import type { HostCamera, HostDrawCamera } from '../../camera/world.ts';
import { clusterColor } from './displayObjects.ts';
import { threeCamera } from './fromGraphNodes.ts';
import type { HostDrawScene } from '../scene/graphNodes.ts';
import {
  asHostLibrary,
  type HostDiagnosticFactory,
  type HostDiagnosticGeometry,
  type HostDiagnosticMaterial,
} from '../resources.ts';

/**
 * The host-renderer adapter: the one renderer every engine drawn by the host library shares
 * over the engine's context, to draw the display graph it holds — the witnesses, and the
 * autonomous WebGL2 path, which is a shipping backend and not a witness. The host never holds a
 * renderer; a user acquires this one at its first draw and releases it at its dispose, and the
 * renderer leaves with the last of them. One per context, so that a texture or a program is
 * uploaded once for the whole session, as the host's own adapter did.
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
type Shared = {
  gl: WebGL2RenderingContext;
  renderer: FramebufferRenderer;
  wrapper: Wrapper;
  users: number;
};
type FramebufferRenderer = THREE.WebGLRenderer & {
  setRenderTargetFramebuffer(target: Wrapper, framebuffer: WebGLFramebuffer): void;
};
const shared = new WeakMap<WebGL2RenderingContext, Shared>();
/** The host renderer's word for each display curve the scene may choose. */
const HOST_CURVE: Record<SceneToneMapping, THREE.ToneMapping> = {
  none: THREE.NoToneMapping,
  linear: THREE.LinearToneMapping,
  reinhard: THREE.ReinhardToneMapping,
  cineon: THREE.CineonToneMapping,
  aces: THREE.ACESFilmicToneMapping,
  agx: THREE.AgXToneMapping,
  neutral: THREE.NeutralToneMapping,
};

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
    entry = { gl, renderer, wrapper, users: 0 };
    shared.set(gl, entry);
  }
  entry.users++;
  return entry;
}

function release(entry: Shared) {
  if (--entry.users > 0) return;
  shared.delete(entry.gl);
  entry.renderer.dispose();
}

/**
 * `drawHostGeometry` of an engine whose image is a Three scene. `render(camera)` opens the
 * frame: it records the host camera the draw uses and zeroes the counters, so that a frame the
 * composer held — nothing drawn — publishes nothing, never the previous draw; `counters()` is
 * `null` before the first frame. Without a context (a session that never draws on the host
 * surface) the draw is refused by name.
 */
export function createThreeSceneDraw(
  gl: WebGL2RenderingContext | undefined,
  display: HostDrawScene,
) {
  const scene = asHostLibrary<THREE.Scene>(display);
  let entry: Shared | undefined,
    camera: HostCamera | undefined,
    counters: { calls: number; triangles: number } | null = null;
  return {
    render(hostCamera: HostCamera) {
      camera = hostCamera;
      counters = { calls: 0, triangles: 0 };
    },
    drawHostGeometry(_camera: HostDrawCamera, output: HostDrawOutput) {
      if (!gl) throw new Error('HOST_SURFACE_MISSING');
      if (!camera) throw new Error('Draw before render');
      entry ??= acquire(gl);
      const { renderer, wrapper } = entry;
      renderer.resetState();
      const tone = output.toneMapped
        ? HOST_CURVE[output.toneMapping ?? DEFAULT_TONE_MAPPING]
        : THREE.NoToneMapping;
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
        renderer.render(scene, threeCamera(asHostLibrary<THREE.Camera>(camera)));
      } finally {
        renderer.autoClear = autoClear;
        scene.background = background;
      }
      counters = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
    },
    counters: () => counters,
    dispose() {
      if (entry) release(entry);
      entry = undefined;
    },
  };
}

const unshaded = (parameters: THREE.MeshBasicMaterialParameters, side: number) =>
  new THREE.MeshBasicMaterial({
    ...parameters,
    side: asHostLibrary<THREE.Side>(side),
  }) as unknown as HostDiagnosticMaterial;

/**
 * THE HOST OBJECTS A DIAGNOSTIC VIEW SWAPS IN. The views are the engine's — which triangle, which
 * cluster, which tint — but what they hang on a host mesh is a host material and a host geometry,
 * and building one is this boundary's work, never a pass's. Nothing is decided here: the salt, the
 * per-triangle colours and the side all arrive computed. No view imports this object; the engine
 * that owns the display graph hands it in (`RenderBackend.hostDiagnostics`).
 */
export const hostDiagnostics: HostDiagnosticFactory = {
  triangleGeometry(geometry) {
    const source = asHostLibrary<THREE.BufferGeometry>(geometry);
    const copy = source.index ? source.toNonIndexed() : source.clone();
    return copy as unknown as HostDiagnosticGeometry;
  },
  vertexColors(geometry, colors) {
    const target = asHostLibrary<THREE.BufferGeometry>(geometry);
    target.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  },
  triangleMaterial: (side) => unshaded({ vertexColors: true, toneMapped: false, fog: false }, side),
  clusterMaterial: (id, side) => unshaded({ color: clusterColor(id, 0.75) }, side),
};
