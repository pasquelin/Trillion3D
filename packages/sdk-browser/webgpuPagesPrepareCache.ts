import { createGpuPageCache } from './gpuPages.ts';
import { type WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/**
 * Le cache de pages GPU du moteur, avec son branchement de trace. Les événements du cache ne sont
 * relevés que si la trace est demandée : sinon aucune fermeture n'est posée, et le cache n'a même
 * pas d'observateur à appeler.
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
