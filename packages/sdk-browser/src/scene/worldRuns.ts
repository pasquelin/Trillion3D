/**
 * THE RUNS OF THE WORLD BINARY: bundles contiguous in it, read as one ranged request — a page of
 * the session's queue that is a range of the binary (`StreamPage.range`), each bundle checked by
 * the queue as it lands —, and the pages of each bundle viewed on the bytes read. The pinned top
 * is read at open, before any queue, by the same range and the same checks.
 */
import {
  worldBundlePages,
  type WorldRoots,
  type WorldRootsBundle,
} from '../../../sdk-core/src/manifest/worldRoots.ts'
import type { rangedReader } from '../cluster/ranged.ts'
import { corruptObject } from '../cluster/pages.ts'
import type { ByteMeter } from '../cluster/byteMeter.ts'
import { verifyPageBytes } from '../page/decode/host.ts'
import type { StreamPage } from '../streaming/types.ts'

/** Bundles `[first, end)` of the binary: where they start, and their bytes end to end. */
export function bundleSpan(
  table: { bundles: readonly Pick<WorldRootsBundle, 'offset' | 'bytes'>[] },
  first: number,
  end: number,
) {
  const from = table.bundles[first].offset,
    last = table.bundles[end - 1]
  return { offset: from, bytes: last.offset + last.bytes - from }
}

/** The page of the session's queue that reads bundles `[first, end)` of `table`'s binary at `url`,
 *  checked bundle by bundle. */
export function runPage(table: WorldRoots, url: string, first: number, end: number): StreamPage {
  const { offset, bytes } = bundleSpan(table, first, end)
  const parts = table.bundles.slice(first, end)
  return { url: `${url}#${first}-${end}`, bytes, sha256: '', range: { file: url, offset, parts } }
}

/** The pages of bundle `bundle` on `bytes`, the run read from bundle `first`. */
export function bundleIn(bytes: Uint8Array, table: WorldRoots, first: number, bundle: number) {
  const { offset, bytes: length, count } = table.bundles[bundle],
    start = offset - table.bundles[first].offset
  return worldBundlePages(bytes.subarray(start, start + length), count, bundle)
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
  const { offset, bytes } = bundleSpan(table, first, end)
  const got = new Uint8Array(await read(offset, bytes, { meter }))
  if (got.byteLength !== bytes)
    throw corruptObject(`${url}#${first}-${end}`, { bytes, sha256: '' }, got.byteLength, undefined)
  const pages = []
  for (let bundle = first; bundle < end; bundle++) {
    const own = table.bundles[bundle],
      start = own.offset - offset
    const { sha256 } = await verifyPageBytes(got.slice(start, start + own.bytes).buffer)
    if (sha256 !== own.sha256) throw corruptObject(`${url}#${bundle}`, own, own.bytes, sha256)
    pages.push(bundleIn(got, table, first, bundle))
  }
  return pages
}
