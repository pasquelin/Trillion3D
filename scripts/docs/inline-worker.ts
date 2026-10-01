/** A disposable build-time module graph, including every transitive import. */
import { parentPort, workerData } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';

const exports: Record<string, unknown> = await import(pathToFileURL(workerData).href);
parentPort!.postMessage(
  Object.entries(exports)
    .map(([name, value]) => `export const ${name} = ${JSON.stringify(value)};`)
    .join('\n'),
);
