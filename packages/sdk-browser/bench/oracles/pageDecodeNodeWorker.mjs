/**
 * Un `Worker` du DOM porté par un vrai fil `worker_threads`, pour prouver `pageDecodePool.ts` et
 * `pageDecodeHost.ts` avec un exécutant réel plutôt qu'un mock. `pageDecodeWorker.ts` lit et écrit
 * `globalThis.postMessage` / `globalThis.onmessage`, que `worker_threads` ne connaît pas : un petit
 * fichier pont, écrit une fois par worker dans un dossier temporaire, relie les deux sans toucher au
 * fichier réel. Le worker importe `pageDecodeWorker.ts` par son URL, exactement comme le pool le fait
 * dans un navigateur.
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

/** Le `Worker` réel : un fil `worker_threads` par instance, comme un `Worker` de module. */
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

/** Un exécutant mort dès sa construction : la panne de démarrage que le pool doit encaisser. */
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

/** Répond avec succès à la toute première requête (l'épreuve de démarrage), quel que soit son
 *  contenu, puis meurt avant de répondre à la suivante : le pool casse une fois démarré. */
export class FlakyNodeWorker {
  onmessage = null;
  onerror = null;
  onmessageerror = null;
  #count = 0;
  postMessage(message) {
    // Le bail de mémoire partagée n'est pas un travail : il ne consomme pas la réponse unique.
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

/** Installe `globalThis.Worker` pour la durée de `run`, et le retire toujours ensuite. */
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
