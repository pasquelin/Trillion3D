import { EngineError } from '../../../sdk-core/src/index.ts';
import { detectCapabilities } from '../../capabilities.ts';
import { requestExplorerDevice } from '../../explorerGpuDevice.ts';

export type WorldRenderer = 'webgpu' | 'webgl2';

/**
 * What the machine grants before any scene is loaded: the path a world will draw with. A forced
 * path the machine lacks is refused by its name; left to the engine, WebGPU when an adapter is
 * granted — and its device, requested once —, WebGL2 otherwise, and a machine with neither is
 * refused. `chooseBackends` repeats the same decision on that device when a session opens.
 */
export async function probeWorldRenderer(
  canvas: HTMLCanvasElement,
  forced: WorldRenderer | undefined,
): Promise<{ renderer: WorldRenderer; gpuDevice?: GPUDevice }> {
  if (forced !== 'webgl2') {
    const gpu = await detectCapabilities('webgpu', canvas);
    // The world holds its device for its whole life: every session it opens draws on it.
    if (gpu.renderer && gpu.adapter)
      return { renderer: 'webgpu', gpuDevice: await requestExplorerDevice(gpu.adapter) };
    if (forced === 'webgpu')
      throw new EngineError(
        'WEBGPU_UNAVAILABLE',
        `The renderer "webgpu" was requested, and this machine grants none: ${gpu.reason}`,
      );
  }
  const webgl = await detectCapabilities('webgl', canvas);
  if (webgl.renderer) return { renderer: 'webgl2' };
  throw new EngineError(
    'NO_WEBGL2',
    forced === 'webgl2'
      ? `The renderer "webgl2" was requested, and this machine grants none: ${webgl.reason}`
      : 'This machine grants neither WebGPU nor WebGL2.',
  );
}
