// Runs in the browser through Playwright serialization.
export async function startupTargets() {
  const { createExplorer, createExplorerJob, webgpuPagesBackend } = window.sdk;
  const canvas = document.getElementById('viewer');
  const options = {
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
  const images = [],
    triangles = [];
  for (const target of ['viewer', canvas, 'viewer']) {
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
  const failure = async (target, extra = {}) => {
    try {
      await createExplorer(target, { ...options, ...extra });
      return 'unexpected success';
    } catch (error) {
      return `${error.code ?? error.name}: ${error.message}`;
    }
  };
  const missing = await failure('missing'),
    wrong = await failure(document.body);
  const unsupported = await failure('viewer', {
    interactive: true,
    gpu: { requestAdapter: async () => null },
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
