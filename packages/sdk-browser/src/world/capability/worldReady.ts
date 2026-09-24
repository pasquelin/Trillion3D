import { EngineError } from '../../../../sdk-core/src/index.ts';
import { detectCapabilities } from '../../measurement/capabilities.ts';
import { requestExplorerDevice } from '../session/gpuDevice.ts';

/** The two ways a world can draw: WebGPU, or WebGL2 when WebGPU is missing. */
export type WorldRenderer = 'webgpu' | 'webgl2';

/** The device of a granted adapter, or why none was granted: an adapter may still refuse it. */
async function requestDevice(adapter: GPUAdapter) {
  try {
    return { device: await requestExplorerDevice(adapter), reason: '' };
  } catch (error) {
    return { device: null, reason: `its adapter refused a device: ${String(error)}` };
  }
}

/**
 * What the machine grants before any scene is loaded: the path a world will draw with. A forced
 * path the machine lacks is refused by its name; left to the engine, WebGPU when an adapter and
 * its device are granted — the device requested once —, WebGL2 otherwise (no adapter, or an
 * adapter refusing its device), and a machine with neither is refused. `chooseBackends` repeats
 * the same decision on that device when a session opens.
 */
export async function probeWorldRenderer(
  canvas: HTMLCanvasElement,
  forced: WorldRenderer | undefined,
): Promise<{ renderer: WorldRenderer; gpuDevice?: GPUDevice }> {
  if (forced !== 'webgl2') {
    const gpu = await detectCapabilities('webgpu', canvas);
    // The world holds its device for its whole life: every session it opens draws on it.
    const granted = gpu.renderer && gpu.adapter ? await requestDevice(gpu.adapter) : null;
    if (granted?.device) return { renderer: 'webgpu', gpuDevice: granted.device };
    if (forced === 'webgpu')
      throw new EngineError(
        'WEBGPU_UNAVAILABLE',
        `The renderer "webgpu" was requested, and this machine grants none: ${granted?.reason || gpu.reason}`,
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
