import { EngineError } from '../sdk-core/index.ts';
import { detectCapabilities } from './capabilities.ts';
import { requestExplorerDevice } from './explorerGpuDevice.ts';
import { webgpuPagesBackend } from './webgpuPages.ts';
import type { ExplorerSession } from './explorerSession.ts';

/** What the machine offers, read before the scene: the backend choice depends on it, and the
 *  scene file the session loads depends on the choice. */
export type ExplorerProbe = Awaited<ReturnType<typeof probeExplorerCapabilities>>;

/** True when a WebGPU device is worth asking for: the host did not pin the session to the
 *  autonomous path, and either named no backend or named the WebGPU page raster among them. */
function wantsWebgpu(options: ExplorerSession['options']) {
  if (options.autonomousGeometry === true) return false;
  return !options.backends || options.backends.includes(webgpuPagesBackend);
}

/** WebGL2 is the floor: a machine without it renders nothing here, and says so by name. A
 *  WebGPU device is then requested when it could serve; its absence is a reported fallback,
 *  never a failure. */
export async function probeExplorerCapabilities(session: ExplorerSession) {
  const { canvas, options, scope, emit, diagnose } = session;
  const capabilities = await detectCapabilities('webgl', canvas);
  if (!capabilities.renderer) {
    emit({
      eventVersion: 1,
      type: 'fatal',
      audience: 'blocking',
      recovered: false,
      code: 'NO_WEBGL2',
      detail: capabilities.reason,
    });
    diagnose('error', 'WebGL2 capability check failed', {
      kind: 'error',
      code: 'NO_WEBGL2',
      reason: capabilities.reason,
      scope,
    });
    throw new EngineError('NO_WEBGL2', capabilities.reason);
  }
  emit({
    eventVersion: 1,
    type: 'capability',
    audience: 'diagnostic',
    recovered: true,
    code: 'WEBGL2_BASELINE',
    detail: capabilities.reason,
  });
  diagnose('capability', 'WebGL2 capability detected', {
    kind: 'capability',
    backend: 'webgl',
    reason: capabilities.reason,
    scope,
  });
  let gpuDevice: GPUDevice | undefined;
  try {
    if (wantsWebgpu(options)) {
      const gpu = options.gpu ?? (typeof navigator === 'undefined' ? undefined : navigator.gpu);
      if (gpu) {
        const gpuCaps = await detectCapabilities('webgpu', canvas, { gpu });
        if (gpuCaps.renderer) {
          emit({
            eventVersion: 1,
            type: 'capability',
            audience: 'diagnostic',
            recovered: true,
            code: 'WEBGPU_AVAILABLE',
            detail: gpuCaps.reason,
          });
          diagnose('capability', 'WebGPU capability detected', {
            kind: 'capability',
            backend: 'webgpu',
            reason: gpuCaps.reason,
            scope,
          });
        }
        if (gpuCaps.adapter) gpuDevice = await requestExplorerDevice(gpuCaps.adapter);
      }
    }
  } catch (error) {
    diagnose('fallback', 'WebGPU setup unavailable; WebGL path retained', {
      kind: 'fallback',
      backend: 'webgpu',
      error: String(error),
      scope,
    }); /* WebGPU stays optional; the autonomous WebGL2 path remains. */
  }
  return { capabilities, gpuDevice };
}
