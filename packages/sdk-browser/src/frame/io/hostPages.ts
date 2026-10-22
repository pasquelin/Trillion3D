import { pageRequestUrl } from '../../geometry/selection/requests.ts'
import { acceptPage } from './pageApi.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

/**
 * Takes in the pages the streaming waits on that only the host can give: started, their bytes not
 * in, no read serving them (`hostPages`, `../../geometry/residency/queue.ts`). The queue stops on
 * such a page, and nothing drawn again moves it; they are asked of the host's reader (`readPage`,
 * as the root cover's missing pages are, `../loop/bootstrap.ts`) and handed to the engine as the
 * host hands them (`acceptPage`), all at once, the streaming having bounded how many are started.
 * Only the pages listed are asked, once each: what a page depends on is read by the streaming.
 * @returns How many pages stay without their bytes: all of them when no reader was named.
 */
export async function fetchHostPages(rt: WebgpuPagesRuntime) {
  const pages = rt.services.residency.hostPages()
  if (!pages.length) return 0
  const { readPage, signal } = rt.context
  if (!readPage) return pages.length
  await Promise.all(
    [...new Set(pages.map(pageRequestUrl))].map(async (url) => {
      const bytes = await readPage(url)
      signal?.throwIfAborted()
      if (rt.run.lost) throw new Error('WEBGPU_LOST')
      acceptPage(rt, url, bytes)
    }),
  )
  return 0
}
