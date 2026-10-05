// The first module of every bench worker thread: gives it the worker globals a browser worker has
// (`self`, `postMessage`, `onmessage`, `location`, `fetch` of its own files, `Worker`), then imports
// the engine's worker module. Messages that arrive before that module listens wait for it, as a
// browser worker's do.
import { parentPort, workerData } from 'node:worker_threads';
import { installFileFetch } from './fileFetch.ts';
import { installWorker } from './worker.ts';

const port = parentPort!;
const { url, search } = workerData as { url: string; search: string };
const scope = globalThis as unknown as Record<string, unknown> & EventTarget;
const events = new EventTarget();

installFileFetch();
installWorker();
const location = new URL(url);
location.search = search;
Object.assign(scope, {
  self: scope,
  location,
  postMessage: (data: unknown, transfer?: Transferable[]) =>
    port.postMessage(data, transfer as never),
  addEventListener: events.addEventListener.bind(events),
  removeEventListener: events.removeEventListener.bind(events),
  close: () => process.exit(0),
});

class WorkerMessage extends Event {
  readonly data: unknown;
  constructor(data: unknown) {
    super('message');
    this.data = data;
  }
}

const deliver = (data: unknown) => {
  const event = new WorkerMessage(data);
  (scope.onmessage as ((e: Event) => void) | undefined)?.(event);
  events.dispatchEvent(event);
};

const early: unknown[] = [];
let ready = false;
port.on('message', (data) => (ready ? deliver(data) : early.push(data)));
await import(url);
ready = true;
for (const data of early.splice(0)) deliver(data);
