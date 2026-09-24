/** A physics worker faked in place of `Worker`: it keeps the command words the page sends it. */
export interface FakeWorker {
  onmessage(event: { data: unknown }): void;
  words: Uint32Array[];
}

/** Replaces `Worker` with fakes, each listed in `workers`; `restore` puts the real one back. */
export function fakeWorkers() {
  const workers: FakeWorker[] = [];
  const saved = globalThis.Worker;
  globalThis.Worker = class {
    words: Uint32Array[] = [];
    onmessage = (_: { data: unknown }) => {};
    constructor() {
      workers.push(this);
    }
    postMessage(message: { type: string; words?: Uint32Array }) {
      if (message.words) this.words.push(message.words);
    }
    terminate() {}
  } as unknown as typeof Worker;
  return { workers, restore: () => void (globalThis.Worker = saved) };
}

/** The session's code, fetched on the first use (`worldPhysics.ts`), has been loaded. */
export const loaded = () =>
  import('./session.ts').then(() => new Promise((done) => setTimeout(done, 0)));
