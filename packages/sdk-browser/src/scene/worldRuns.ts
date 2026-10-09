/**
 * THE WORLD BUNDLES AS PAGES. Each bundle of the binary is one page of a page queue — a session's,
 * or the one a world's model loads through before any session —, a range of the binary
 * (`StreamPage.range`) checked against its own digest, admitted once as the queue binds or loads
 * (`bundlePages`): the queue reads the ranges queued end to end in the binary by one request
 * (`../streaming/queueRanges.ts`). A bundle of no bytes is no page: its pages, none, are known
 * without a read.
 */
import { worldBundlePages, type WorldRoots } from '../../../sdk-core/src/manifest/worldRoots.ts'
import type { PageQueue, StreamPage } from '../streaming/types.ts'
import { PRIORITY_VISIBLE } from '../streaming/priority.ts'

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

/** The file `page` names, read whole through `queue` on `signal`, verified against its
 *  fingerprint: a world's table or DAG, which its reader decodes and holds. Its bytes are that
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
