/**
 * THE WORLD BUNDLES AS PAGES, AND READ AT OPEN. Each bundle past the pinned top is one page of the
 * session's queue, a range of the binary (`StreamPage.range`) checked against its own digest,
 * admitted once as the session binds (`bundlePages`): the queue reads the ranges queued end to end
 * in the binary by one request (`../streaming/queueRanges.ts`). The pinned top, and a scene's one
 * cell when it is not partitioned, are read at open, before any queue, in their contiguous runs,
 * each by one range and the same check (`verifiedRun`).
 */
import {
  worldBundlePages,
  type WorldRoots,
  type WorldRootsPage,
} from '../../../sdk-core/src/manifest/worldRoots.ts'
import type { rangedReader } from '../cluster/ranged.ts'
import type { ByteMeter } from '../cluster/byteMeter.ts'
import { verifiedRun } from '../cluster/verified.ts'
import type { StreamPage } from '../streaming/types.ts'

/** The name of bundle `bundle` of the binary at `url` in the queue's catalogue. */
export const bundleUrl = (url: string, bundle: number) => `${url}#${bundle}`

/** The pages of `table`'s bundles past its pinned top, ranges of its binary at `url`: their holds
 *  keep what they view of them, not the page cache. */
export function bundlePages(table: WorldRoots, url: string) {
  const pages: StreamPage[] = []
  for (let bundle = table.pinned; bundle < table.bundles.length; bundle++) {
    const { offset, bytes, sha256 } = table.bundles[bundle]
    const range = { file: url, offset }
    pages.push({ url: bundleUrl(url, bundle), bytes, sha256, range, kept: false })
  }
  return pages
}

/** Bundles `[first, end)` of `table`'s binary at `url`, read at open by `read` (`rangedReader`) in
 *  one range `meter` counts, each checked against its digest: their pages, bundle by bundle. */
export async function readSpan(
  read: ReturnType<typeof rangedReader>,
  url: string,
  table: WorldRoots,
  [first, end]: readonly [number, number],
  meter: ByteMeter,
) {
  const bundles = table.bundles.slice(first, end),
    last = bundles[bundles.length - 1]
  const from = bundles[0].offset,
    run = bundles.map((own, at) => ({ ...own, url: bundleUrl(url, first + at) }))
  const checked = await verifiedRun(
    run,
    await read(from, last.offset + last.bytes - from, { meter }),
  )
  return checked.map((own, at) => {
    if (!own.bytes) throw own.refused
    return worldBundlePages(own.bytes, bundles[at].count, first + at)
  })
}

/** A read of bundles `[first, end)` at open: their pages, bundle by bundle. */
export type SpanRead = (span: [number, number]) => Promise<WorldRootsPage[][]>

/** The pages of `bundles`, held as `owns`, read at open in their contiguous runs by `read`. */
export async function readAtOpen(
  bundles: readonly number[],
  owns: { pages?: WorldRootsPage[] }[],
  read: SpanRead,
) {
  for (let at = 0; at < bundles.length;) {
    let end = at + 1
    while (end < bundles.length && bundles[end] === bundles[end - 1] + 1) end++
    const pages = await read([bundles[at], bundles[end - 1] + 1])
    pages.forEach((own, i) => (owns[at + i].pages = own))
    at = end
  }
}
