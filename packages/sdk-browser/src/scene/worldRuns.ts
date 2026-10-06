/**
 * THE RUNS OF THE WORLD BINARY: bundles contiguous in it read as one ranged request, checked
 * bundle by bundle against their digests, each bundle on its way until its run lands or is dropped
 * (`worldBundles.ts`). A run waits in the session's read queue once it is given (`readThrough`),
 * and is read at once before.
 */
import {
  worldBundlePages,
  type WorldRoots,
  type WorldRootsPage,
} from '../../../sdk-core/src/manifest/worldRoots.ts'
import type { rangedReader } from '../cluster/ranged.ts'
import { corruptObject } from '../cluster/pages.ts'
import { ONE_REQUEST } from '../cluster/checked.ts'
import { unmetered, type ByteMeter } from '../cluster/byteMeter.ts'
import { verifyPageBytes } from '../page/decode/host.ts'
import { PRIORITY_VISIBLE } from '../streaming/priority.ts'
import type { RangedRead } from '../streaming/types.ts'

type Read = ReturnType<typeof rangedReader>
type Range = readonly [first: number, end: number]

/** The bytes of bundles `[first, end)` of the binary, one ranged request `read` makes and `meter`
 *  counts, asked `attempts` times at most (`checked`). */
export async function readRange(
  read: Read,
  table: WorldRoots,
  [first, end]: Range,
  meter: ByteMeter = unmetered,
  attempts?: number,
) {
  const from = table.bundles[first].offset,
    last = table.bundles[end - 1]
  return new Uint8Array(await read(from, last.offset + last.bytes - from, meter, attempts))
}

/** The pages of bundles `[first, end)` on `bytes`, their range of the binary at `url`: each bundle
 *  checked against its digest. */
export function rangePages(bytes: Uint8Array, url: string, table: WorldRoots, [first, end]: Range) {
  const from = table.bundles[first].offset
  return Promise.all(
    table.bundles.slice(first, end).map(async (bundle, i) => {
      const start = bundle.offset - from
      const verified = await verifyPageBytes(bytes.slice(start, start + bundle.bytes).buffer)
      if (verified.sha256 !== bundle.sha256)
        throw corruptObject(`${url}#${first + i}`, bundle, bundle.bytes, verified.sha256)
      return worldBundlePages(new Uint8Array(verified.source), bundle.count, first + i)
    }),
  )
}

/** A signal nothing aborts: a run read at once, before the session's queue. */
const never = new AbortController().signal

/** A run of bundles `[first, end)` read as one range, and how many of them a cell holds. */
type Run = { first: number; end: number; wanted: number; stop: AbortController }
/** A bundle's pages, and the run that reads them. */
export type Flight = { pages: Promise<WorldRootsPage[]>; run: Run }

/** The runs of `table`'s binary at `url` that `read` reads, through the session's queue once it is
 *  given (`readThrough`), and the bundles on their way, each until its run lands or is dropped. */
export function createRuns(table: WorldRoots, url: string, read: Read) {
  const flying = new Map<number, Flight>()
  let through: RangedRead = (_key, _bytes, load) => load(never)
  /** `run`'s bundles are no longer on their way. */
  const forget = (run: Run) => {
    for (let bundle = run.first; bundle < run.end; bundle++)
      if (flying.get(bundle)?.run === run) flying.delete(bundle)
  }
  /** Bundles `[first, end)` read as one range at `priority`, each on its way until it lands. */
  const readRun = (first: number, end: number, priority: number) => {
    const run: Run = { first, end, wanted: 0, stop: new AbortController() }
    const range = [first, end] as const,
      last = table.bundles[end - 1]
    const bytes = last.offset + last.bytes - table.bundles[first].offset
    // Asked once: a run that fails waits its cell's turn (`../partition/retries.ts`).
    const load = () => readRange(read, table, range, unmetered, ONE_REQUEST)
    const all = through(`${url}#${first}-${end}`, bytes, load, run.stop.signal, priority).then(
      (got) => rangePages(got, url, table, range),
    )
    const landed = () => forget(run)
    all.then(landed, landed)
    for (let bundle = first; bundle < end; bundle++) {
      const pages = all.then((list) => list[bundle - first])
      pages.catch(() => {}) // a run dropped unread fails no one: its holds let it go first
      flying.set(bundle, { pages, run })
    }
    return run
  }
  return {
    flying,
    /** `bundle` read for the one request, at the view's priority: its reader wants it, so its run is
     *  never dropped. */
    once(bundle: number) {
      readRun(bundle, bundle + 1, PRIORITY_VISIBLE).wanted++
      return flying.get(bundle)!.pages
    },
    /** No cell wants `run` any more: dropped from the queue unread while it waits. */
    drop(run: Run) {
      forget(run)
      run.stop.abort()
    },
    /** Each run of the `missing` bundles, ascending, that are contiguous in the binary is read. */
    readMissing(missing: readonly number[], priority: number) {
      for (let at = 0, end = 1; at < missing.length; at = end++) {
        while (end < missing.length && missing[end] === missing[end - 1] + 1) end++
        readRun(missing[at], missing[end - 1] + 1, priority)
      }
    },
    /** The session's read queue, which every later run waits in. */
    readThrough(queue: RangedRead) {
      through = queue
    },
  }
}
