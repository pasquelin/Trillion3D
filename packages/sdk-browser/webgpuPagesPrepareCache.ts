import { createGpuPageCache } from './gpuPages.ts';
import { type WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/**
 * The engine's GPU page cache, with its trace hook. Cache events are sampled only if trace is
 * requested: otherwise no closure is posted, and the cache does not even have an observer to call.
 */
export function createWebgpuPagesCache(rt: WebgpuPagesRuntime, gpuDevice: GPUDevice) {
  const { diag, run, services } = rt,
    { pageBytes, slots } = rt.setup;
  const options = (
    diag.traceEnabled
      ? {
          pageBytes,
          slots,
          onDiagnostic: (event: {
            phase: string;
            message: string;
            context: Record<string, unknown>;
          }) =>
            diag.traceDiagnostic(`cache-${event.phase}`, event.message, () => ({
              ...event.context,
              frame: run.frame,
            })),
        }
      : { pageBytes, slots }
  ) as Parameters<typeof createGpuPageCache>[2];
  return createGpuPageCache(gpuDevice, services.pageSource, options);
}
