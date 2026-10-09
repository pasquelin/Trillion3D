import type { PageSource } from '../../../../sdk-core/src/index.ts'
import { refusedStatus } from '../../cluster/checked.ts'
import type { EngineDiagnostic } from '../../engine/types.ts'
import { lazyDiagnostic } from '../../diagnostic/engineDiagnostic.ts'

/** `key`'s bytes from `source`, a source that throws as it is asked included. */
function asked(source: PageSource, key: string, signal: AbortSignal, priority?: number) {
  try {
    return Promise.resolve(source.read(key, signal, priority))
  } catch (error) {
    return Promise.reject(error)
  }
}

/**
 * The GPU page pool's reads of its source, each told to the diagnostics that listen. Every load
 * reads its page from the source, which joins the reads of a page in flight: the engine's source is
 * its page streamer, where a read joins the page's one job, raised to the most urgent read's
 * priority (`streaming/queueRequest.ts`), and is counted by the view it waits for; an HTTP source
 * is a page streamer too (`httpPageSource`).
 */
export function createGpuPageReader(
  source: PageSource,
  pageBytes: number,
  diagnostic: ((diagnostic: EngineDiagnostic) => void) | undefined,
) {
  const report = typeof diagnostic === 'function' ? diagnostic : undefined
  const emit = lazyDiagnostic(report)
  const now = () => (report ? performance.now() : 0)
  /** `key`'s bytes from the source, read on `signal` at `priority`. Its failure is caught here
   *  already: one that fails before its load's turn comes is no unhandled rejection, and the load
   *  that awaits it meets it. */
  const read = (key: string, signal: AbortSignal, priority?: number) => {
    const started = now()
    emit?.('gpu-page-read-start', 'GPU page read started', () => ({ version: 1, key }))
    const reading = asked(source, key, signal, priority).then(
      (bytes) => {
        const durationMs = now() - started
        emit?.('gpu-page-read-end', 'GPU page read finished', () => ({
          version: 1,
          key,
          status: null,
          expectedBytes: pageBytes,
          actualBytes: bytes.byteLength,
          durationMs,
        }))
        return bytes
      },
      (error: unknown) => {
        const durationMs = now() - started
        emit?.('gpu-page-read-end', 'GPU page read failed', () => ({
          version: 1,
          key,
          status: refusedStatus(error),
          error: String(error),
          durationMs,
        }))
        throw error
      },
    )
    reading.catch(() => {})
    return reading
  }
  return { report, emit, now, read }
}
