import type { Job, StreamContext } from './types.ts'
import { manifestEntryBytes } from './manifestTables.ts'

/** How a streamer's jobs end and its pages leave the catalogue: a page `forget` asks to drop
 *  while a job holds it leaves when that job ends (`end`), unless `keep` takes it back first. */
export function createQueueEnds(context: StreamContext, sync: (url: string) => void) {
  const { jobs, state, catalog, store, failures, abortError } = context
  /** Pages `forget` asked to drop while a job held them. */
  const forgotten = new Set<string>()
  /** A page leaves the catalogue with its bytes, and with its failure unless its wait runs:
   *  admitted again meanwhile, it still waits it out (`failures.ts`). */
  const drop = (url: string) => {
    if (!catalog.delete(url)) return
    failures.leaves(url)
    store.drop(url)
    state.tableBytes -= manifestEntryBytes(url)
  }
  /** The single exit of a job: it releases its url, and a page forgotten meanwhile leaves. After
   *  `dispose` a kept store is the next session's: a late settle no longer drops from it. */
  const end = (url: string, job: Job) => {
    if (jobs.get(url) === job) jobs.delete(url)
    sync(url)
    if (!jobs.has(url) && forgotten.delete(url) && !state.disposed) drop(url)
  }
  return {
    /** A page under way leaves once its read ends; one waiting its turn after a failure is no
     *  read under way: its askers are let go, and it leaves now. */
    forget(url: string) {
      const job = jobs.get(url)
      if (!job) return drop(url)
      forgotten.add(url)
      if (job.state !== 'waiting') return
      end(url, job)
      job.reject(abortError())
    },
    keep: (url: string) => forgotten.delete(url),
    /** Whether `forget` asked `url` to leave while a job held it. */
    forgotten: (url: string) => forgotten.has(url),
    end,
  }
}
