/**
 * THE READER OF A MANIFEST'S PAGES. While the manifest loads, each page is read and checked by
 * `fetchVerified` with the load's signal and meter; a lazy manifest's mesh pages, which the view
 * holds, are read once bound (`SessionPages.bind`) through the queue of the session drawing them,
 * as each hold asks — at its priority, with the signal that lets it go —, so they wait their turn
 * with every other read of the view.
 */
import type { ManifestPages, PageAsk } from '../../../sdk-core/src/manifest/paged.ts'
import type { TablePage } from '../../../sdk-core/src/scene/core/tablePages.ts'
import { fetchVerified } from '../cluster/pages.ts'
import { unmetered, type ByteMeter } from '../cluster/byteMeter.ts'
import type { PageQueue } from '../streaming/types.ts'

/** A lazy manifest's mesh pages, read through the queue of the session drawing them once it binds
 *  it (`bind`). */
export type SessionPages = ManifestPages & { bind(queue: PageQueue): void }

/** The reader of a manifest's pages relative to `metadataUrl`: checked by `fetchVerified` with the
 *  load's `signal` and `meter` until it settles, then through the queue of the session that binds
 *  it, each hold's read as it is asked — its priority, and the signal that lets it go. */
export function pageReader(metadataUrl: string, signal: AbortSignal | undefined, meter: ByteMeter) {
  let reading: { signal?: AbortSignal; meter: ByteMeter } = { signal, meter },
    queue: PageQueue | undefined,
    bytes = 0
  const read = async (page: TablePage, asked?: PageAsk) => {
    const url = new URL(page.url, metadataUrl).href
    if (queue) {
      queue.admit([{ url, bytes: page.bytes, sha256: page.sha256 }])
      // A copy: the primitives view their sidecar's bytes, which the page cache may let go.
      return (await queue.readBytes(url, asked?.signal, asked?.priority)).slice()
    }
    const got = await fetchVerified(url, page, reading.signal, reading.meter)
    bytes += got.byteLength
    return new Uint8Array(got)
  }
  return {
    read,
    bytes: () => bytes,
    settle: () => void (reading = { meter: unmetered }),
    bind: (session: PageQueue) => void (queue = session),
  }
}
