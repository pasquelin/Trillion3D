/**
 * A DOM `Worker` carried by a real `worker_threads` thread, to prove `packages/sdk-browser/src/page/decode/pool.ts` and
 * `packages/sdk-browser/src/page/decode/host.ts` with a real worker rather than a mock. `pageDecodeWorker.ts` reads and writes
 * `globalThis.postMessage` / `globalThis.onmessage`, which `worker_threads` does not know: a small
 * bridge file, written once per worker in a temporary folder, joins the two without touching the
 * real file. The worker imports `pageDecodeWorker.ts` by its URL, exactly as the pool does in a
 * browser.
 */
import {
  Worker as ThreadWorker,
  type Transferable as ThreadTransferable,
} from 'node:worker_threads';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dossier = mkdtempSync(join(tmpdir(), 'trillion3d-worker-dom-'));
let compteur = 0;

function pont(url: URL) {
  const chemin = join(dossier, `pont-${compteur++}.mjs`);
  writeFileSync(
    chemin,
    `import { parentPort } from 'node:worker_threads';\n` +
      `globalThis.postMessage = (message, transfer) => parentPort.postMessage(message, transfer);\n` +
      `await import(${JSON.stringify(url.href)});\n` +
      `parentPort.on('message', (data) => globalThis.onmessage?.({ data }));\n`,
  );
  return chemin;
}

/** The three callbacks a DOM `Worker` carries, at the minimal shape this bridge reads and writes:
 *  one event object with a `data` field, nothing else read from it. */
type NodeWorkerHandler = ((ev: { data: unknown }) => void) | null;

/** The real `Worker`: one `worker_threads` thread per instance, like a module `Worker`. */
export class NodeDomWorker {
  #worker: ThreadWorker;
  onmessage: NodeWorkerHandler = null;
  onerror: NodeWorkerHandler = null;
  onmessageerror: NodeWorkerHandler = null;
  constructor(url: URL) {
    this.#worker = new ThreadWorker(pont(url));
    this.#worker.on('message', (data) => this.onmessage?.({ data }));
    this.#worker.on('error', () => this.onerror?.({ data: undefined }));
    this.#worker.on('messageerror', () => this.onmessageerror?.({ data: undefined }));
  }
  postMessage(message: unknown, transfer?: readonly ThreadTransferable[]) {
    this.#worker.postMessage(message, transfer);
  }
  terminate() {
    return this.#worker.terminate();
  }
}

/** A worker dead from construction: the startup failure the pool must absorb. */
export class DeadNodeWorker {
  onmessage: NodeWorkerHandler = null;
  onerror: NodeWorkerHandler = null;
  onmessageerror: NodeWorkerHandler = null;
  constructor() {
    queueMicrotask(() => this.onerror?.({ data: undefined }));
  }
  postMessage() {}
  terminate() {}
}

/** A startup-probe or decode request, the only two messages the pool ever posts. */
interface PoolMessage {
  op?: string;
  protocol: unknown;
  id: unknown;
  source?: unknown;
}

/** Answers the very first request successfully (the startup probe), whatever its contents, then
 *  dies before answering the next: the pool breaks once started. */
export class FlakyNodeWorker {
  onmessage: NodeWorkerHandler = null;
  onerror: NodeWorkerHandler = null;
  onmessageerror: NodeWorkerHandler = null;
  #count = 0;
  postMessage(message: PoolMessage) {
    // The shared-memory lease is not work: it does not consume the unique answer.
    if (message.op === 'share') return;
    this.#count++;
    if (this.#count === 1) {
      queueMicrotask(() =>
        this.onmessage?.({
          data: {
            protocol: message.protocol,
            id: message.id,
            ok: true,
            sha256: '',
            source: message.source ?? null,
            decoded: null,
            wasm: false,
            taskMs: 0,
          },
        }),
      );
    } else queueMicrotask(() => this.onerror?.({ data: undefined }));
  }
  terminate() {}
}

/** A worker constructor as this bridge fakes it: enough of `Worker` for the pool to construct,
 *  message and terminate one, never the rest of the DOM interface. */
export interface NodeWorkerLike {
  new (url: URL): {
    onmessage: NodeWorkerHandler;
    onerror: NodeWorkerHandler;
    onmessageerror: NodeWorkerHandler;
    postMessage(message: unknown, transfer?: readonly ThreadTransferable[]): void;
    terminate(): unknown;
  };
}

/** Installs `globalThis.Worker` for the duration of `run`, and always removes it afterwards. */
export async function withNodeWorkerShim<T>(
  implementation: NodeWorkerLike,
  run: () => Promise<T>,
): Promise<T> {
  const precedent = globalThis.Worker;
  globalThis.Worker = implementation as typeof Worker;
  try {
    return await run();
  } finally {
    if (precedent === undefined) delete (globalThis as { Worker?: typeof Worker }).Worker;
    else globalThis.Worker = precedent;
  }
}
