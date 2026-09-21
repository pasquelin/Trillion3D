// Runs in the browser through Playwright serialization.
import type { ExplorerOptions, ExplorerTarget } from '../../packages/sdk-browser/index.ts';

export async function startupTargets() {
  const { createExplorer, createExplorerJob, webgpuPagesBackend } = window.sdk;
  const canvas = document.getElementById('viewer');
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('missing #viewer canvas');
  const options: ExplorerOptions = {
    manifestUrl: '/cache/city/manifest.json',
    scope: 'full',
    backends: [webgpuPagesBackend],
    width: 240,
    height: 160,
    pixelRatio: 1,
    temporalAntialiasing: false,
    geometryPoolBytes: 16 * 1024 * 1024,
    texturePoolBytes: 128 * 1024 * 1024,
  };
  const images: number[][] = [],
    triangles: [number | null | undefined, number | null | undefined][] = [];
  const targets: ExplorerTarget[] = ['viewer', canvas, 'viewer'];
  for (const target of targets) {
    const e = await createExplorer(target, options);
    await e.awaitPages();
    e.setDiagnostic('beauty'); // Force an encoded frame so submitted triangles describe this draw.
    const metrics = e.render();
    await e.flush();
    images.push(Array.from(e.capture()));
    triangles.push([metrics.totalSubmittedTriangles, metrics.selectedTriangles]);
    e.dispose();
  }
  const differences = images
    .slice(1)
    .map((image) => image.filter((value, i) => value !== images[0][i]).length);
  const failure = async (
    target: ExplorerTarget | HTMLElement,
    extra: Partial<ExplorerOptions> = {},
  ) => {
    try {
      await createExplorer(target as ExplorerTarget, { ...options, ...extra });
      return 'unexpected success';
    } catch (error) {
      const details = error as { code?: string; name?: string; message?: string };
      return `${details.code ?? details.name}: ${details.message}`;
    }
  };
  const missing = await failure('missing'),
    wrong = await failure(document.body);
  // A stub `GPU`, branded like the real one, whose adapter request always fails: the case
  // this proof exercises is startup with no usable adapter, not a missing `navigator.gpu`.
  const noAdapterGpu: GPU = {
    __brand: 'GPU',
    requestAdapter: async () => null,
    getPreferredCanvasFormat: () => 'bgra8unorm',
    wgslLanguageFeatures: new Set(),
  };
  const unsupported = await failure('viewer', {
    interactive: true,
    gpu: noAdapterGpu,
  });
  const job = await createExplorerJob('scene-job', 'viewer', { ...options, interactive: true });
  const e = await job.promise;
  const overrides = [e.canvas.width, e.canvas.height];
  e.dispose();
  const controller = new AbortController();
  const aborted = await createExplorer(canvas, {
    ...options,
    interactive: true,
    signal: controller.signal,
  });
  controller.abort();
  let disposedOnAbort = false;
  try {
    aborted.render();
  } catch {
    disposedOnAbort = true;
  }
  const unsized = document.createElement('canvas');
  document.body.append(unsized);
  const invalidLayout = await failure(unsized, {
    interactive: true,
    width: undefined,
    height: undefined,
    pixelRatio: 2,
  });
  unsized.remove();
  const cancelled = await createExplorerJob('cancelled-job', 'viewer', options);
  cancelled.cancel();
  try {
    await cancelled.promise;
  } catch {
    /* Cancellation is asserted below. */
  }
  return {
    differences,
    disposedOnAbort,
    invalidLayout,
    triangles,
    missing,
    wrong,
    unsupported,
    overrides,
    cancelled: cancelled.getSnapshot().status,
    hasImage: new Set(images[0]).size > 4,
  };
}
