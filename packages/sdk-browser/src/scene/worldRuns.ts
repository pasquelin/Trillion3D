/**
 * THE RUNS OF THE WORLD BINARY: bundles contiguous in it, read as one ranged request — a page of
 * the session's queue that is a range of the binary (`StreamPage.range`), each bundle checked by
 * the queue as it lands —, and the pages of each bundle viewed on the bytes read. The pinned top
 * is read at open, before any queue, by the same range and the same checks.
 */
import { worldBundlePages, type WorldRoots } from '../../../sdk-core/src/manifest/worldRoots.ts'
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
