import type { PageSource } from '../../../../sdk-core/src/index.ts'
import { refusedStatus } from '../../cluster/checked.ts'
import type { EngineDiagnostic } from '../../engine/types.ts'
import { lazyDiagnostic } from '../../diagnostic/engineDiagnostic.ts'

/**
 * The GPU page pool's reads of its source, each told to the diagnostics that listen. Every load
 * reads its page from the source, which joins the reads of a page in flight: the engine's source is
 * its page streamer, where a read joins the page's one job, raised to the most urgent read's
 * priority (`streaming/queueRequest.ts`), and is counted by the view it waits for.
 */
export function createGpuPageReader(
  source: PageSource,
  pageBytes: number,
  diagnostic: ((diagnostic: EngineDiagnostic) => void) | undefined,
) {
  const report = typeof diagnostic === 'function' ? diagnostic : undefined
  const emit = lazyDiagnostic(report)
  const now = () => (report ? performance.now() : 0)
  /** `key`'s bytes from the source, read on `signal` at `priority`. */
  const read = (key: string, signal: AbortSignal, priority?: number) => {
    const started = now()
    const durationMs = () => (report ? performance.now() - started : null)
    emit?.('gpu-page-read-start', 'GPU page read started', () => ({ version: 1, key }))
    let raw: Promise<Uint8Array>
    try {
      raw = source.read(key, signal, priority)
    } catch (error) {
      raw = Promise.reject(error)
    }
    return Promise.resolve(raw).then(
      (bytes) => {
        emit?.('gpu-page-read-end', 'GPU page read finished', () => ({
          ...{ version: 1, key, status: null, expectedBytes: pageBytes },
          ...{ actualBytes: bytes.byteLength, durationMs: durationMs() },
        }))
        return bytes
      },
      (error: unknown) => {
        emit?.('gpu-page-read-end', 'GPU page read failed', () => ({
          ...{ version: 1, key, status: refusedStatus(error), error: String(error) },
          durationMs: durationMs(),
        }))
        throw error
      },
    )
  }
  return { report, emit, now, read }
}
