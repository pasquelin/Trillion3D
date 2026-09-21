// Runs inside the browser page (`page.evaluate`): DOM Worker, MessageEvent and fetch are ambient.

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
}: {
  pageUrl: string;
  decodeWorkerUrl: string;
  integrationWorkerUrl: string;
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
  const decode = await run<DecodeWorkerResult>(
    decodeWorkerUrl,
    { protocol: 3, id: 1, op: 'decode', source, maxDecodedBytes: 16 * 1024 * 1024 },
    [source],
  );
  const specs = new Int32Array([0, 1, 7]);
  const integration = await run<IntegrationWorkerResult>(
    integrationWorkerUrl,
    { protocol: 1, id: 1, url: 'installed-proof', words: 3, specs: specs.buffer },
    [specs.buffer],
  );
  return { decode, integration };
}
