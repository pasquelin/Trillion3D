/**
 * THE RUNS OF THE WORLD BINARY: bundles contiguous in it, read as one ranged request — a page of
 * the session's queue that is a range of the binary (`StreamPage.range`), each bundle checked by
 * the queue as it lands —, and the pages of each bundle viewed on the bytes read, delivered to the
 * bundles held on the run all at once or, one refused, not at all. The pinned top, and a scene's
 * one cell when it is not partitioned, are read at open, before any queue, in their runs, by the
 * same range and the same checks.
 */
import {
  worldBundlePages,
  type WorldRoots,
  type WorldRootsPage,
} from '../../../sdk-core/src/manifest/worldRoots.ts'
import type { rangedReader } from '../cluster/ranged.ts'
import type { ByteMeter } from '../cluster/byteMeter.ts'
import { partSpan, verified } from '../streaming/rangeParts.ts'

/** Bundles `[first, end)` of the binary: where they start, and their bytes end to end. */
function bundleSpan(table: WorldRoots, first: number, end: number) {
  const from = table.bundles[first].offset,
    last = table.bundles[end - 1]
  return { offset: from, bytes: last.offset + last.bytes - from }
}

/** The page of the session's queue that reads bundles `[first, end)` of `table`'s binary at `url`,
 *  checked bundle by bundle; the holds that read it keep its bundles' pages, not the page cache. */
export function runPage(table: WorldRoots, url: string, first: number, end: number) {
  const { offset, bytes } = bundleSpan(table, first, end)
  const range = { file: url, offset, parts: table.bundles.slice(first, end) }
  return { url: `${url}#${first}-${end}`, bytes, sha256: '', range, kept: false }
}

/** The pages of bundle `bundle` on `bytes`, the run read from bundle `first`. */
export function bundleIn(bytes: Uint8Array, table: WorldRoots, first: number, bundle: number) {
  const own = table.bundles[bundle]
  const span = partSpan(table.bundles[first].offset, own)
  return worldBundlePages(bytes.subarray(...span), own.count, bundle)
}

/** Bundles `[first, end)` of `table`'s binary at `url`, read at open by `read` (`rangedReader`) in
 *  one range `meter` counts, checked as the queue checks their run (`verified`): their pages,
 *  bundle by bundle. */
export async function readSpan(
  read: ReturnType<typeof rangedReader>,
  url: string,
  table: WorldRoots,
  [first, end]: readonly [number, number],
  meter: ByteMeter,
) {
  const page = runPage(table, url, first, end)
  const checked = await verified(
    page,
    page.url,
    await read(page.range.offset, page.bytes, { meter }),
  )
  if (!checked.buffer) throw checked.refused
  const got = new Uint8Array(checked.buffer)
  return page.range.parts.map((_, at) => bundleIn(got, table, first, first + at))
}

/** The end of the run of `bundles` from `at`: those after it contiguous in the binary and
 *  `wanted`. */
function runEnd(bundles: readonly number[], at: number, wanted: (at: number) => boolean) {
  let end = at + 1
  while (end < bundles.length && bundles[end] === bundles[end - 1] + 1 && wanted(end)) end++
  return end
}

/** A read of bundles `[first, end)` at open: their pages, bundle by bundle. */
export type SpanRead = (span: [number, number]) => Promise<WorldRootsPage[][]>

/** The pages of `bundles`, held as `owns`, read at open in their contiguous runs by `read`. */
export async function readAtOpen(bundles: readonly number[], owns: Held[], read: SpanRead) {
  for (let at = 0; at < bundles.length;) {
    const end = runEnd(bundles, at, () => true)
    const pages = await read([bundles[at], bundles[end - 1] + 1])
    pages.forEach((own, i) => (owns[at + i].pages = own))
    at = end
  }
}

/** A run of bundles `[first, end)`, one page of the queue at `url` read for the bundles held on
 *  it whoever asked: its bytes once landed and viewed on them, and what stops it — once none is
 *  held on it, or once it failed, its bundles still held on it, wanted. */
export type Run = {
  first: number
  end: number
  url: string
  landing: Promise<Uint8Array>
  stop: AbortController
}
/** A bundle a cell holds: how many cells, its pages once read, the run reading them till then. */
export type Held = { cells: number; pages?: WorldRootsPage[]; run?: Run }

/** Each run of `bundles`, held as `owns`, neither read nor on its way — a stopped one is read
 *  again —, contiguous in the binary, started by `start`: the stopped runs they replaced. */
export function startRuns(
  bundles: readonly number[],
  owns: readonly Held[],
  start: (first: number, end: number) => Run,
) {
  const unread = (at: number) => !owns[at].pages && (owns[at].run?.stop.signal.aborted ?? true)
  const stopped = new Set<Run>()
  for (let at = 0, end = 0; at < bundles.length; at = Math.max(at + 1, end)) {
    if (!unread(at)) continue
    end = runEnd(bundles, at, unread)
    const own = start(bundles[at], bundles[end - 1] + 1)
    for (let i = at; i < end; i++) {
      const was = owns[i].run
      if (was) stopped.add(was)
      owns[i].run = own
    }
  }
  return stopped
}
