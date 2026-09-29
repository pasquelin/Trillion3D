import { invertMatrix4 } from '../../../../../sdk-core/src/index.ts';
import {
  SURFACE_BYTES_PER_PIXEL,
  checkSurfaceSize,
  createSurfaceBuffer,
  type SurfaceCapture,
} from '../../../scene/surfaceBuffer.ts';
import { collectPendingUrls } from '../../../page/selection/selection.ts';
import { awaitedPages } from '../../row/pageSlots.ts';
import { viewProj } from '../helpers.ts';
import type { HostCamera } from '../../../camera/world.ts';
import { captureAside, drawResidentCut, renderForCapture } from './captureAside.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

type CaptureOptions = { width: number; height: number; signal?: AbortSignal };

/** Copies the surfaces of the second view into buffers the host owns until it disposes them. */
function copySurfaces(
  rt: WebgpuPagesRuntime,
  gpuDevice: GPUDevice,
  options: CaptureOptions,
  reserve: number,
): SurfaceCapture {
  const { gpu, capture, diag } = rt,
    eye = rt.run.gate.cam.eye;
  if (!rt.vis.visEnabled || !gpu.surfaces || !gpu.depthTexture)
    throw new Error('SURFACE_CAPTURE_UNAVAILABLE');
  const owned = createSurfaceBuffer(gpuDevice, options.width, options.height);
  let depth: GPUTexture;
  try {
    depth = gpuDevice.createTexture({
      label: 'Trillion3D owned surface depth',
      size: { width: options.width, height: options.height },
      format: 'depth32float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
    });
  } catch (error) {
    owned.dispose();
    throw error;
  }
  let released = false;
  const result: SurfaceCapture = {
    ...owned,
    allocationBytes: reserve,
    depth,
    inverseViewProjection: [...invertMatrix4(new Float64Array(16), viewProj)],
    // The second view has just entered through the contract: its world eye is the one the engine
    // camera carries, without rereading the host camera or recomputing anything.
    cameraWorld: [eye[0], eye[1], eye[2]],
    selectedTriangles: rt.run.selectedTriangles,
    dispose() {
      if (released) return;
      released = true;
      owned.dispose();
      depth.destroy();
      capture.captureAllocationBytes = 0;
      capture.surfaceCapture = undefined;
      diag.engineDiagnostic('surface-capture-released', 'GPU capture released', {
        allocationBytes: reserve,
      });
    },
  };
  const encoder = gpuDevice.createCommandEncoder();
  const from = [
      gpu.surfaces.baseMetal,
      gpu.surfaces.normalRough,
      gpu.surfaces.emissiveAo,
      gpu.surfaces.flags,
      gpu.depthTexture,
    ],
    to = [owned.baseMetal, owned.normalRough, owned.emissiveAo, owned.flags, depth];
  for (let i = 0; i < from.length; i++)
    encoder.copyTextureToTexture({ texture: from[i] }, { texture: to[i] }, [
      options.width,
      options.height,
    ]);
  gpuDevice.queue.submit([encoder.finish()]);
  return result;
}

/** Renders a second camera into owned material surfaces, in a view of its own (`captureAside`). */
export async function captureSurfaceView(
  rt: WebgpuPagesRuntime,
  camera: HostCamera,
  options: CaptureOptions,
) {
  const { run, capture, context, diag } = rt,
    gpuDevice = rt.gpu.device;
  context.signal?.throwIfAborted();
  options.signal?.throwIfAborted();
  if (capture.capturing || capture.surfaceCapture)
    throw new Error('SURFACE_CAPTURE_BUSY: dispose the previous capture first');
  if (run.lost || !gpuDevice || !rt.vis.visEnabled || !run.lastCamera)
    throw new Error('SURFACE_CAPTURE_UNAVAILABLE');
  // The surfaces and their depth. Temporal-antialiasing history stays allocated during capture:
  // it counts with it.
  const reserve =
    checkSurfaceSize(gpuDevice, options.width, options.height, SURFACE_BYTES_PER_PIXEL + 4) +
    (rt.gpu.temporal?.historyBytes ?? 0);
  // Capture entry: the camera comes from the host like an image's, and the engine reads it as
  // it reads any other — resolved pose, declared optics — at the aspect ratio of the surface
  // written into rather than the one the camera declares for the host's own canvas.
  const aspect = options.width / options.height;
  const started = performance.now();
  const throwIfAborted = () => {
    options.signal?.throwIfAborted();
    context.signal?.throwIfAborted();
  };
  const diagnostic = run.diagnostic;
  let result: SurfaceCapture | undefined;
  capture.captureAllocationBytes = reserve;
  diag.engineDiagnostic('surface-capture-start', 'GPU capture from a second camera', {
    width: options.width,
    height: options.height,
    allocationBytes: reserve,
  });
  try {
    await captureAside(rt, options, async () => {
      throwIfAborted();
      run.diagnostic = 'beauty';
      await renderForCapture(rt, camera, aspect);
      await drawResidentCut(rt, gpuDevice, {
        admitted: () => {
          // Before the cover is resident a view's CPU cut publishes nothing (`../render/cpu.ts`):
          // the capture's own `desired` is still empty, so it awaits the cover.
          const asked = rt.services.bootstrapState.ready ? run.desired : rt.layout.gpuWanted;
          const missing = collectPendingUrls(awaitedPages(asked, run.awaitedScratch), []);
          if (missing.length) throw new Error(`SURFACE_PAGES_NOT_RESIDENT: ${missing.length}`);
          if (run.coverageBudgetLimited) throw new Error('SURFACE_PAGE_BUDGET');
        },
        beforeEncode: throwIfAborted,
      });
      result = copySurfaces(rt, gpuDevice, options, reserve);
      await gpuDevice.queue.onSubmittedWorkDone();
      throwIfAborted();
      if (run.lost) throw new Error('WEBGPU_LOST');
    });
  } catch (error) {
    result?.dispose();
    capture.captureAllocationBytes = 0;
    diag.diagnosticFailure('surface-capture-failed', error);
    throw error;
  } finally {
    run.diagnostic = diagnostic;
  }
  capture.surfaceCapture = result;
  diag.engineDiagnostic('surface-capture-ready', 'Surface GPU ready', {
    surfaceVersion: 1,
    width: options.width,
    height: options.height,
    selectedTriangles: run.selectedTriangles,
    allocationBytes: reserve,
    durationMs: performance.now() - started,
    imageReadback: false,
  });
  return result!;
}
