import type { Job, StreamContext } from './types.ts'
import { refusalOf } from './failures.ts'

/** How a streamer's jobs end and its pages leave the catalogue: a page `forget` asks to drop
 *  while a job holds it leaves when that job ends (`end`), unless `keep` takes it back first. */
export function createQueueEnds(context: StreamContext, sync: (url: string) => void) {
  const { jobs, state, failures, catalog, store } = context
  /** Pages `forget` asked to drop while a job held them. */
  const forgotten = new Set<string>()
  /** A page leaves the catalogue with its bytes, and with its failure once its wait is over:
   *  asked again meanwhile, it is still refused. */
  const drop = (url: string) => {
    if (!refusalOf(context, url)) failures.delete(url)
    if (catalog.delete(url)) store.drop(url)
  }
  return {
    forget(url: string) {
      if (jobs.has(url)) forgotten.add(url)
      else drop(url)
    },
    keep: (url: string) => forgotten.delete(url),
    /** The single exit of a job: it releases its url, and a page forgotten meanwhile leaves. After
     *  `dispose` a kept store is the next session's: a late settle no longer drops from it. */
    end(url: string, job: Job) {
      if (jobs.get(url) === job) jobs.delete(url)
      sync(url)
      if (!jobs.has(url) && forgotten.delete(url) && !state.disposed) drop(url)
    },
  }
}
