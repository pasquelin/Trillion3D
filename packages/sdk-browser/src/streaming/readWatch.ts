import { PRIORITY_VISIBLE } from './priority.ts';

/** What a watcher hears: the pages read since it started watching, and those landed. */
export type PageReads = { landed: number; asked: number };

type Watch = { reading: Map<string, number>; landed: Set<string>; heard: () => void };
/** One watch as its watcher holds it (`watch`'s return). */
export type PageWatch = { reads: () => PageReads; hold: (url: string) => void; stop: () => void };
const counted = ({ landed, reading }: Watch): PageReads => ({
  landed: landed.size,
  asked: landed.size + reading.size,
});

/**
 * Every page read of a streamer passes here (`read`), whoever asks it: the host's own batches and
 * the reads an engine makes on its own — the WebGPU residency reads its pages one by one (#408).
 * `watch` counts those the view waits on — a prefetch, read behind them, is not — while it runs,
 * each page once: asked when its first read starts, landed when one resolves; a page whose every
 * read was dropped before landing is no longer asked. What changes within a task is heard once;
 * `landed` never goes back.
 */
export function createReadWatch(
  subscribe: (url: string, signal?: AbortSignal, priority?: number) => Promise<Uint8Array>,
) {
  const watches = new Set<Watch>();
  let owed = false;
  /** Every watch hears once what changed within the task. */
  const hear = () => {
    if (owed) return;
    owed = true;
    queueMicrotask(() => {
      owed = false;
      watches.forEach((watch) => watch.heard());
    });
  };
  const read = (url: string, signal?: AbortSignal, priority?: number) => {
    const reading = subscribe(url, signal, priority);
    if (!watches.size || (priority ?? PRIORITY_VISIBLE) > PRIORITY_VISIBLE) return reading;
    const askedBy: Watch[] = [];
    for (const watch of watches)
      if (!watch.landed.has(url)) {
        askedBy.push(watch);
        watch.reading.set(url, (watch.reading.get(url) ?? 0) + 1);
      }
    // A page every watch counts as landed already changes no count: nothing to hear of it.
    if (!askedBy.length) return reading;
    hear();
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
  /** Calls `heard` as pages are read and land, until `stop`; `reads` counts them now, `hold`
   *  counts a page resident already as landed, once. */
  const watch = (heard: () => void): PageWatch => {
    const entry: Watch = { reading: new Map(), landed: new Set(), heard };
    watches.add(entry);
    return {
      reads: () => counted(entry),
      hold: (url: string) => void (entry.reading.delete(url), entry.landed.add(url)),
      stop: () => void watches.delete(entry),
    };
  };
  return { read, watch };
}
