import { createSceneLightStore } from '../../../packages/sdk-core/src/index.ts';
import { autonomousPagesBackend } from '../../../packages/sdk-browser/src/backend/autonomous/pages.ts';
import { webgpuPagesBackend } from '../../../packages/sdk-browser/src/webgpu/pages/pages.ts';
import { pagedManifest } from '../../../packages/sdk-browser/src/backend/autonomous/geometryPages.fixture.ts';
import { createFrameComposer } from '../../../packages/sdk-browser/src/world/render/compose.ts';
import type { BackendContext } from '../../../packages/sdk-browser/src/backend/types.ts';
import { libere } from './sharedSceneProof.ts';
import { image, PLAFOND, difference } from './sceneImageProof.ts';
import type { mirrorScene } from './screenMirrorScene.ts';

export type MirrorPath = 'webgpu' | 'webgl2';
export const MIRROR_SIZE = 192;

export async function mirrorRenderer(
  path: MirrorPath,
  rig: ReturnType<typeof mirrorScene>,
  device: GPUDevice,
  events: unknown[],
  bounce = false,
) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = MIRROR_SIZE;
  document.body.append(canvas);
  const lights = createSceneLightStore();
  lights.add({
    id: 'sun',
    kind: 'directional',
    direction: [0, 0, -1],
    color: [1, 1, 1],
    intensity: 0.1,
    castsShadow: false,
  });
  const { scene, camera } = rig;
  const context: BackendContext = {
    source: scene.source,
    metadata: scene.metadata,
    indices: scene.indices,
    associations: scene.associations,
    viewport: [MIRROR_SIZE, MIRROR_SIZE],
    clearColor: 0,
    temporalAntialiasing: false,
    bounce,
    sceneLights: lights,
    onDiagnostic: (event) => events.push(event),
  };
  const gl = path === 'webgl2' ? canvas.getContext('webgl2') : null;
  if (path === 'webgl2' && !gl) throw new Error('WebGL2 unavailable');
  const backend = gl
    ? autonomousPagesBackend({
        ...context,
        ...pagedManifest(scene.metadata, scene.geometries),
        indices: new Map(),
        webglContext: gl,
      })
    : webgpuPagesBackend({ ...context, gpuDevice: device, gpuCanvas: canvas });
  const compose = gl ? createFrameComposer(gl, camera) : null;
  await backend.prepare();
  const frame = async () => {
    if (!gl) {
      const result = await image(backend, camera);
      return { pixels: result.pixels.slice(), held: result.metriques.frameHeld === true };
    }
    backend.render(camera);
    compose!(backend, null);
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    await backend.flush?.();
    if (gl.getError() !== gl.NO_ERROR) throw new Error('WebGL2 read/render error');
    return { pixels, held: backend.frameHeld === true };
  };
  return {
    backend,
    resize(size: number) {
      context.viewport![0] = context.viewport![1] = size;
      if (gl) canvas.width = canvas.height = size;
    },
    async held() {
      for (let i = 0; i < PLAFOND; i++) {
        const result = await frame();
        if (result.held) {
          const repeated = await frame();
          if (!repeated.held) throw new Error('Static mirror frame unexpectedly woke');
          return { pixels: result.pixels, stable: difference(result.pixels, repeated.pixels) };
        }
      }
      throw new Error(`${path}: mirror frame never held`);
    },
    dispose() {
      compose?.dispose();
      libere(backend, canvas, scene);
    },
  };
}
