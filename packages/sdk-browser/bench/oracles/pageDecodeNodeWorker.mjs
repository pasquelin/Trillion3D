/**
 * A DOM `Worker` carried by a real `worker_threads` thread, to prove `pageDecodePool.ts` and
 * `pageDecodeHost.ts` with a real worker rather than a mock. `pageDecodeWorker.ts` reads and writes
 * `globalThis.postMessage` / `globalThis.onmessage`, which `worker_threads` does not know: a small
 * bridge file, written once per worker in a temporary folder, joins the two without touching the
 * real file. The worker imports `pageDecodeWorker.ts` by its URL, exactly as the pool does in a
 * browser.
 */
import { Worker as ThreadWorker } from 'node:worker_threads';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dossier = mkdtempSync(join(tmpdir(), 'wg-worker-dom-'));
let compteur = 0;

function pont(url) {
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

/** The real `Worker`: one `worker_threads` thread per instance, like a module `Worker`. */
export class NodeDomWorker {
  #worker;
  onmessage = null;
  onerror = null;
  onmessageerror = null;
  constructor(url) {
    this.#worker = new ThreadWorker(pont(url));
    this.#worker.on('message', (data) => this.onmessage?.({ data }));
    this.#worker.on('error', () => this.onerror?.());
    this.#worker.on('messageerror', () => this.onmessageerror?.());
  }
  postMessage(message, transfer) {
    this.#worker.postMessage(message, transfer);
  }
  terminate() {
    return this.#worker.terminate();
  }
}

/** A worker dead from construction: the startup failure the pool must absorb. */
export class DeadNodeWorker {
  onmessage = null;
  onerror = null;
  onmessageerror = null;
  constructor() {
    queueMicrotask(() => this.onerror?.());
  }
  postMessage() {}
  terminate() {}
}

/** Answers the very first request successfully (the startup probe), whatever its contents, then
 *  dies before answering the next: the pool breaks once started. */
export class FlakyNodeWorker {
  onmessage = null;
  onerror = null;
  onmessageerror = null;
  #count = 0;
  postMessage(message) {
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
    } else queueMicrotask(() => this.onerror?.());
  }
  terminate() {}
}

/** Installs `globalThis.Worker` for the duration of `run`, and always removes it afterwards. */
export async function withNodeWorkerShim(implementation, run) {
  const precedent = globalThis.Worker;
  globalThis.Worker = implementation;
  try {
    return await run();
  } finally {
    if (precedent === undefined) delete globalThis.Worker;
    else globalThis.Worker = precedent;
  }
}
