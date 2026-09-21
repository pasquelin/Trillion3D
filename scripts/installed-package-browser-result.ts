import type { EvaluatedInstalledPage } from './installed-package-browser-page.ts';
import type { DecodeWorkerResult, IntegrationWorkerResult } from './installed-package-workers.ts';
import type { RequestRecord } from './installed-package-server.ts';

interface CommonWorkerMessage {
  translation: number[];
  commonSubset: boolean;
}

export interface InstalledBrowserProof {
  metrics: Record<string, number>;
  capture: EvaluatedInstalledPage['capture'];
  hierarchy: EvaluatedInstalledPage['hierarchy'];
  commonWorker: CommonWorkerMessage | undefined;
  workerDecode: { wasm?: boolean; vertexCount: number | null; taskMs?: number };
  workerIntegration: { count?: number; pageCount?: number; taskMs?: number };
  requests: RequestRecord[];
  moduleRequestCount: number;
  browserVersion: string;
}

export function installedBrowserResult({
  result,
  workers,
  requests,
  evidence,
  allowNodeModules,
  browserVersion,
  errors,
}: {
  result: EvaluatedInstalledPage;
  workers: { decode: DecodeWorkerResult; integration: IntegrationWorkerResult };
  requests: RequestRecord[];
  evidence: RequestRecord[];
  allowNodeModules: boolean;
  browserVersion: string;
  errors: string[];
}): InstalledBrowserProof {
  const { metrics, capture, hierarchy } = result;
  // The page result crosses the `page.evaluate` boundary untyped: cast once, at the point it is read.
  const commonWorker = result.commonWorker as CommonWorkerMessage | undefined;
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
    !commonWorker?.commonSubset ||
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
