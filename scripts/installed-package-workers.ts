// `runInstalledWorkers` runs inside the browser page (`page.evaluate`): DOM Worker, MessageEvent
// and fetch are ambient, and nothing it imports survives the trip. The messages are therefore
// built here, in Node, from the engine's own contracts, and handed to it as arguments.
import {
  PAGE_DECODE_PROTOCOL,
  PAGE_INTEGRATION_PROTOCOL,
  type PageDecodeRequest,
  type PageIntegrationRequest,
} from '../packages/sdk-core/src/index.ts';

/** The messages the installed workers receive, minus the buffers the page makes and transfers. */
export interface InstalledWorkerRequests {
  decode: Omit<PageDecodeRequest, 'source'>;
  integration: Omit<PageIntegrationRequest, 'specs'> & { specs: number[] };
}

/** One decode of the proof page, and one arrival of a single-page, one-triangle sheet. */
export function installedWorkerRequests(): InstalledWorkerRequests {
  return {
    decode: {
      protocol: PAGE_DECODE_PROTOCOL,
      id: 1,
      op: 'decode',
      maxDecodedBytes: 16 * 1024 * 1024,
    },
    integration: {
      protocol: PAGE_INTEGRATION_PROTOCOL,
      id: 1,
      url: 'installed-proof',
      words: 3,
      specs: [0, 1, 7],
    },
  };
}

/** The decode worker's response message, read once at the boundary where it arrives. */
export interface DecodeWorkerResult {
  ok: boolean;
  wasm?: boolean;
  decoded?: { vertexCount?: number };
  taskMs?: number;
}

/** The integration worker's response message, read once at the boundary where it arrives. */
export interface IntegrationWorkerResult {
  ok: boolean;
  count?: number;
  pageCount?: number;
  taskMs?: number;
}

export async function runInstalledWorkers({
  pageUrl,
  decodeWorkerUrl,
  integrationWorkerUrl,
  requests,
}: {
  pageUrl: string;
  decodeWorkerUrl: string;
  integrationWorkerUrl: string;
  requests: InstalledWorkerRequests;
}): Promise<{ decode: DecodeWorkerResult; integration: IntegrationWorkerResult }> {
  const run = <T>(
    workerUrl: string,
    request: Record<string, unknown>,
    transfer: Transferable[],
  ): Promise<T> => {
    const worker = new Worker(workerUrl, { type: 'module' });
    return new Promise<T>((resolve, reject) => {
      const finish = <V>(settle: (value: V) => void, value: V): void => {
        clearTimeout(timeout);
        worker.terminate();
        settle(value);
      };
      const timeout = setTimeout(
        () => finish(reject, new Error(`installed worker timed out: ${workerUrl}`)),
        30_000,
      );
      worker.onerror = (event) =>
        finish(reject, new Error(`installed worker failed: ${workerUrl}: ${event.message}`));
      worker.onmessageerror = () =>
        finish(reject, new Error(`installed worker message failed: ${workerUrl}`));
      worker.onmessage = ({ data }: MessageEvent<T>) => finish(resolve, data);
      try {
        worker.postMessage(request, transfer);
      } catch (error) {
        finish(reject, error);
      }
    });
  };
  const source = await (await fetch(pageUrl)).arrayBuffer();
  const decode = await run<DecodeWorkerResult>(decodeWorkerUrl, { ...requests.decode, source }, [
    source,
  ]);
  const specs = new Int32Array(requests.integration.specs);
  const integration = await run<IntegrationWorkerResult>(
    integrationWorkerUrl,
    { ...requests.integration, specs: specs.buffer },
    [specs.buffer],
  );
  return { decode, integration };
}
