export function installedBrowserResult({
  result,
  workers,
  requests,
  evidence,
  allowNodeModules,
  browserVersion,
  errors,
}) {
  const { metrics, capture, hierarchy, commonWorker } = result;
  const { decode, integration } = workers;
  if (errors.length) throw new Error(`installed browser errors: ${errors.join('; ')}`);
  if (
    !(metrics?.pagesDecodedOffThread > 0) ||
    !(metrics?.selectedTriangles > 0) ||
    metrics.selectedTriangles !== metrics.drawnTriangles ||
    metrics.uncoveredTriangles !== 0 ||
    capture.aaDifferentPixels !== 0 ||
    !decode?.ok ||
    !decode.wasm ||
    !integration?.ok ||
    commonWorker?.translation?.join(',') !== '7,10,15' ||
    !commonWorker.commonSubset ||
    integration.count !== 1 ||
    integration.pageCount !== 1
  )
    throw new Error(
      `installed worker/WASM proof did not execute every selected path: ${JSON.stringify({ metrics, workers })}`,
    );
  const failed = requests.filter(({ status }) => status >= 400);
  if (failed.length)
    throw new Error(`installed browser requests failed: ${JSON.stringify(failed)}`);
  if (!allowNodeModules && requests.some(({ path }) => path.includes('node_modules')))
    throw new Error('installed browser escaped the bundled output');
  return {
    metrics,
    capture,
    hierarchy,
    commonWorker,
    workerDecode: {
      wasm: decode.wasm,
      vertexCount: decode.decoded?.vertexCount ?? null,
      taskMs: decode.taskMs,
    },
    workerIntegration: {
      count: integration.count,
      pageCount: integration.pageCount,
      taskMs: integration.taskMs,
    },
    requests: evidence,
    moduleRequestCount: requests.length,
    browserVersion,
  };
}
