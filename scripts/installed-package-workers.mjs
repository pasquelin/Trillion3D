export async function runInstalledWorkers({ pageUrl, decodeWorkerUrl, integrationWorkerUrl }) {
  const run = (workerUrl, request, transfer) => {
    const worker = new Worker(workerUrl, { type: 'module' });
    return new Promise((resolve, reject) => {
      const finish = (settle, value) => {
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
      worker.onmessage = ({ data }) => finish(resolve, data);
      try {
        worker.postMessage(request, transfer);
      } catch (error) {
        finish(reject, error);
      }
    });
  };
  const source = await (await fetch(pageUrl)).arrayBuffer();
  const decode = await run(
    decodeWorkerUrl,
    { protocol: 3, id: 1, op: 'decode', source, maxDecodedBytes: 16 * 1024 * 1024 },
    [source],
  );
  const specs = new Int32Array([0, 1, 7]);
  const integration = await run(
    integrationWorkerUrl,
    { protocol: 1, id: 1, url: 'installed-proof', words: 3, specs: specs.buffer },
    [specs.buffer],
  );
  return { decode, integration };
}
