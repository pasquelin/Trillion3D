/**
 * THE WORLD BUNDLES AS PAGES. Each bundle of the binary is one page of the session's queue, a range
 * of the binary (`StreamPage.range`) checked against its own digest, admitted once as the session
 * binds or loads (`bundlePages`): the queue reads the ranges queued end to end in the binary by one
 * request (`../streaming/queueRanges.ts`). A bundle of no bytes is no page: its pages, none, are
 * known without a read. A world's model loads before any session: its pinned top, and its one cell
 * when it is not partitioned, are read then by the one reader of the binary its page cache holds
 * (`PageCache.reader`), each contiguous run by one range, the runs side by side, each bundle
 * checked as the queue checks it (`verifiedRun`).
 */
import {
  worldBundlePages,
  type WorldRoots,
  type WorldRootsPage,
} from '../../../sdk-core/src/manifest/worldRoots.ts'
import type { rangedReader } from '../cluster/ranged.ts'
import type { ByteMeter } from '../cluster/byteMeter.ts'
import { verifiedRun } from '../cluster/verified.ts'
import type { PageQueue, StreamPage } from '../streaming/types.ts'

/** The name of bundle `bundle` of the binary at `url` in the queue's catalogue. */
const bundleUrl = (url: string, bundle: number) => `${url}#${bundle}`

/** The pages of `table`'s bundles from `first`, ranges of its binary at `url`: their holders keep
 *  what they view of them, not the page cache. A bundle of no bytes is none. */
export function bundlePages(table: WorldRoots, url: string, first = 0) {
  const pages: StreamPage[] = []
  for (let bundle = first; bundle < table.bundles.length; bundle++) {
    const { offset, bytes, sha256 } = table.bundles[bundle]
    const range = { file: url, offset }
    if (bytes > 0) pages.push({ url: bundleUrl(url, bundle), bytes, sha256, range, kept: false })
  }
  return pages
}

/** Bundle `bundle` of `table`'s binary at `url` read through `queue` on `signal` at `priority`:
 *  its pages. */
export async function readBundle(
  queue: PageQueue,
  table: WorldRoots,
  url: string,
  bundle: number,
  signal: AbortSignal,
  priority: number,
) {
  const { bytes } = table.bundles[bundle]
  const read = bytes > 0 ? await queue.readBytes(bundleUrl(url, bundle), signal, priority) : null
  return worldBundlePages(table, bundle, read ?? new Uint8Array(0))
}

/** Bundles `[first, end)` of `table`'s binary at `url`, read by `read` (`rangedReader`) in one
 *  range `meter` counts, asked till `signal` — the load's — lets it go, each checked against its
 *  digest: their pages, bundle by bundle. */
export async function readSpan(
  read: ReturnType<typeof rangedReader>,
  url: string,
  table: WorldRoots,
  [first, end]: readonly [number, number],
  { meter, signal }: { meter: ByteMeter; signal?: AbortSignal },
) {
  if (first >= end) return []
  const bundles = table.bundles.slice(first, end),
    last = bundles[bundles.length - 1]
  const from = bundles[0].offset,
    run = bundles.map((own, at) => ({ ...own, url: bundleUrl(url, first + at) }))
  const bytes = await read(from, last.offset + last.bytes - from, { meter, signal })
  const checked = await verifiedRun(run, bytes)
  return checked.map((own, at) => {
    if (!own.bytes) throw own.refused
    return worldBundlePages(table, first + at, own.bytes)
  })
}

/** A read of bundles `[first, end)`: their pages, bundle by bundle. */
export type SpanRead = (span: [number, number]) => Promise<WorldRootsPage[][]>

/** The pages of `bundles`, held as `owns`, read in their contiguous runs by `read`, the runs side
 *  by side. */
export async function readAtOpen(
  bundles: readonly number[],
  owns: { pages?: WorldRootsPage[] }[],
  read: SpanRead,
) {
  const runs: Promise<void>[] = []
  for (let at = 0; at < bundles.length;) {
    let end = at + 1
    while (end < bundles.length && bundles[end] === bundles[end - 1] + 1) end++
    const from = at
    runs.push(
      read([bundles[at], bundles[end - 1] + 1]).then((pages) =>
        pages.forEach((own, i) => (owns[from + i].pages = own)),
      ),
    )
    at = end
  }
  await Promise.all(runs)
}
