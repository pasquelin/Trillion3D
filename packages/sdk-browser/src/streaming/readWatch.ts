/** What a watcher hears: the pages read since it started watching, and those landed. */
export type PageReads = { landed: number; asked: number };

type Watch = { reading: Map<string, number>; landed: Set<string>; heard: () => void };

/**
 * Every page read of a streamer passes here (`read`), whoever asks it: the host's own batches and
 * the reads an engine makes on its own — the WebGPU residency reads its pages one by one (#408).
 * `watch` counts them while it runs, each page once: asked when its first read starts, landed when
 * one resolves; a page whose every read was dropped before landing is no longer asked. Reads asked
 * together are heard as one event, each landing as its own; `landed` never goes back.
 */
export function createReadWatch(
  subscribe: (url: string, signal?: AbortSignal, priority?: number) => Promise<Uint8Array>,
) {
  const watches = new Set<Watch>();
  let owed = false;
  const hear = () => {
    owed = false;
    watches.forEach((watch) => watch.heard());
  };
  const read = (url: string, signal?: AbortSignal, priority?: number) => {
    const reading = subscribe(url, signal, priority);
    const askedBy = [...watches].filter((watch) => !watch.landed.has(url));
    if (!askedBy.length) return reading;
    for (const watch of askedBy) watch.reading.set(url, (watch.reading.get(url) ?? 0) + 1);
    if (!owed) queueMicrotask(() => owed && hear());
    owed = true;
    const settle = (landed: boolean) => {
      for (const watch of askedBy) {
        const left = (watch.reading.get(url) ?? 1) - 1;
        if (landed) watch.landed.add(url);
        if (landed || !left) watch.reading.delete(url);
        else watch.reading.set(url, left);
      }
      hear();
    };
    reading.then(
      () => settle(true),
      () => settle(false),
    );
    return reading;
  };
  /** Hears `onReads` at each page read or landed until the returned stop runs. */
  const watch = (onReads: (reads: PageReads) => void) => {
    const entry: Watch = {
      reading: new Map(),
      landed: new Set(),
      heard: () =>
        onReads({ landed: entry.landed.size, asked: entry.landed.size + entry.reading.size }),
    };
    watches.add(entry);
    return () => void watches.delete(entry);
  };
  return { read, watch };
}
