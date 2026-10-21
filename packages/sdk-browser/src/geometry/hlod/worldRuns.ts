/**
 * THE WORLD BUNDLES AND THEIR PAGES IN THE PAGE CATALOGUE. Each bundle of the binary is one page of
 * a page queue — a session's, or the one a world's model loads through before any session —, a
 * range of the binary (`StreamPage.range`) checked against its own digest and kept in the page
 * cache; each page of it is a slice of that read (`StreamPage.bundle`), named where it lies in the
 * binary as a primitive's page is (`geometryPageAddress`), served by the one reader every page
 * goes through (`../streaming/pageStreamer.ts`). The queue reads the ranges queued end to end in
 * the binary by one request (`../streaming/queueRanges.ts`). A bundle of no bytes is no page.
 */
import { bundlePageRanges, type WorldRoots } from '../../../../sdk-core/src/manifest/worldRoots.ts'
import {
  geometryPageAddress,
  streamBundleAddress,
} from '../../../../sdk-core/src/page/contracts.ts'
import type { PageQueue, StreamPage } from '../streaming/types.ts'
import { PRIORITY_VISIBLE } from '../streaming/priority.ts'

/** The catalogue name of bundle `bundle` of `table`'s binary at `url`. */
export const worldBundleAddress = (table: WorldRoots, url: string, bundle: number) =>
  streamBundleAddress(url, table.bundles[bundle].offset)

/** The catalogue entries of `table`'s bundles from `first`, ranges of its binary at `url`, and of
 *  their pages, slices of them. A bundle of no bytes is none. */
export function worldPages(table: WorldRoots, url: string, first = 0) {
  const pages: StreamPage[] = []
  for (let bundle = first; bundle < table.bundles.length; bundle++) {
    const { offset, bytes, sha256 } = table.bundles[bundle]
    if (bytes === 0) continue
    const own = worldBundleAddress(table, url, bundle)
    pages.push({ url: own, bytes, sha256, range: { file: url, offset } })
    for (const page of bundlePageRanges(table, bundle))
      pages.push({
        url: geometryPageAddress(url, offset + page.offset),
        bytes: page.bytes,
        sha256,
        bundle: { url: own, offset: page.offset },
      })
  }
  return pages
}

/** The file `page` names, read whole through `queue` on `signal`, verified against its
 *  fingerprint: a world's table or DAG, or a scene's animation banks
 *  (`../../scene/drive/scene.ts`), which its reader decodes and holds. Its bytes are that
 *  reader's alone (`StreamPage.kept`), never an entry of the page cache, whose budget holds pages
 *  and levels: the page is catalogued for its read only, and leaves once the read settles. */
export async function readWhole(queue: PageQueue, page: StreamPage, signal: AbortSignal) {
  queue.admit([{ ...page, kept: false }])
  try {
    return await queue.readBytes(page.url, signal, PRIORITY_VISIBLE)
  } finally {
    queue.forget([page.url])
  }
}
