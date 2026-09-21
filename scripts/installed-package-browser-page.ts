// Runs inside the browser page (`page.evaluate`): DOM globals (`location`, `devicePixelRatio`,
// `crypto.subtle`, `Worker`) are ambient.
import type {
  EvaluatedInstalledPage,
  LooseExplorer,
  LooseMetadata,
  LooseSdk,
} from './installed-package-browser-page-types.ts';

export type { EvaluatedInstalledPage } from './installed-package-browser-page-types.ts';

export async function evaluateInstalledPage({
  moduleName,
  manifestUrl,
  replayUrl,
  commonWorkerPath,
}: {
  moduleName: string | null;
  manifestUrl: string;
  replayUrl: string;
  commonWorkerPath: string;
}): Promise<EvaluatedInstalledPage> {
  const deadline = performance.now() + 10_000;
  while (!moduleName && !globalThis.__installedSdk && performance.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 25));
  const sdk: LooseSdk | undefined = moduleName
    ? ((await import(moduleName)) as LooseSdk)
    : globalThis.__installedSdk;
  if (!sdk) throw new Error('installed explorer bundle did not start');
  const count = 2;
  const views = (buffer: Float64Array, stride: number): Float64Array[] =>
    Array.from({ length: count }, (_, index) =>
      buffer.subarray(index * stride, (index + 1) * stride),
    );
  const world = new Float64Array(count * sdk.MATRIX_VALUES);
  sdk.hierarchyUpdateBatch(
    views(world, sdk.MATRIX_VALUES),
    views(new Float64Array([2, 3, 4, 5, 7, 11]), sdk.POSITION_VALUES),
    views(new Float64Array([0, 0, 0, 1, 0, 0, 0, 1]), sdk.QUATERNION_VALUES),
    views(new Float64Array(6).fill(1), sdk.POSITION_VALUES),
    new Uint32Array([sdk.HIERARCHY_ROOT, 0]),
    count,
    new Float64Array(sdk.MATRIX_VALUES),
  );
  const hierarchy = { world: Array.from(world.subarray(28, 31)), parent: 0 };
  if (hierarchy.world.join(',') !== '7,10,15')
    throw new Error('installed browser hierarchy did not execute');
  const commonWorker = await new Promise<unknown>((resolve, reject) => {
    const worker = new Worker(commonWorkerPath, { type: 'module' });
    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error('installed common worker timed out'));
    }, 30_000);
    worker.onmessage = ({ data }) => {
      clearTimeout(timeout);
      worker.terminate();
      resolve(data);
    };
    worker.onerror = (event) => {
      clearTimeout(timeout);
      worker.terminate();
      reject(new Error(event.message));
    };
  });
  const open = async (target: string, url: string): Promise<LooseExplorer> => {
    const explorer = await sdk.createExplorer(target, {
      manifestUrl: url,
      scope: 'slice',
      interactive: false,
      pixelError: 1_000,
    });
    const readyBy = performance.now() + 30_000;
    while (!explorer.profiler.lastMetrics?.coverageReady && performance.now() < readyBy)
      await new Promise((resolve) => setTimeout(resolve, 50));
    await new Promise((resolve) => setTimeout(resolve, 250));
    explorer.setPose(explorer.pointsOfInterest()[0].pose);
    explorer.setPixelError(0);
    explorer.invalidate();
    await explorer.awaitPages();
    explorer.render();
    await explorer.flush();
    return explorer;
  };
  const primer = await open('primer', manifestUrl);
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  const replay = await open('replay', replayUrl);
  const samples = [primer, replay].map((item) => item.profiler.lastMetrics);
  const value: Record<string, number> = { ...samples[1] };
  for (const key of ['pagesDecodedOffThread', 'pagesDecodedWasm', 'pagesPlannedOffThread'])
    value[key] = Math.max(...samples.map((sample) => sample?.[key] ?? 0));
  const pointerUrl = new URL(manifestUrl, location.href);
  const pointer = (await (await fetch(pointerUrl)).json()) as { url: string };
  const metadataUrl = new URL(pointer.url, pointerUrl);
  const slim = (await (await fetch(metadataUrl)).json()) as LooseMetadata;
  const metadata = slim.binary
    ? sdk.decodeManifestBinary(
        slim,
        await (await fetch(new URL(slim.binary.url, metadataUrl))).arrayBuffer(),
      )
    : slim;
  const geometry = metadata.primitives
    .flatMap((primitive) => primitive.pages)
    .find((item) => item.geometry)?.geometry;
  if (!geometry) throw new Error('installed cache carries no geometry page');
  const capture = replay.capture();
  replay.render();
  await replay.flush();
  const repeated = replay.capture();
  let aaDifferentPixels = 0;
  for (let index = 0; index < capture.length; index += 4)
    if (
      capture[index] !== repeated[index] ||
      capture[index + 1] !== repeated[index + 1] ||
      capture[index + 2] !== repeated[index + 2] ||
      capture[index + 3] !== repeated[index + 3]
    )
      aaDifferentPixels++;
  const hash = async (bytes: Uint8ClampedArray<ArrayBuffer>): Promise<string> =>
    [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  const captureEvidence = {
    sha256: await hash(capture),
    repeatedSha256: await hash(repeated),
    aaDifferentPixels,
    byteLength: capture.byteLength,
    width: replay.canvas.width,
    height: replay.canvas.height,
    dpr: devicePixelRatio,
    pixelError: 0,
    camera: replay.pointsOfInterest()[0].pose,
    capabilities: replay.capabilities,
  };
  value.drawnTriangles ??= value.submittedTriangles;
  value.uncoveredTriangles ??= value.selectedTriangles - value.drawnTriangles;
  replay.dispose();
  primer.dispose();
  return {
    metrics: value,
    capture: captureEvidence,
    geometryUrl: new URL(geometry.url, metadataUrl).href,
    hierarchy,
    commonWorker,
  };
}
