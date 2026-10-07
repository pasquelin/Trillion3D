import { verified } from './verified.ts'
import { unmetered, type ByteMeter } from './byteMeter.ts'
import { checked } from './checked.ts'
/**
 * Reads the cache object at `url` (`checked`) and hands its bytes back only when they are the ones
 * its manifest `announced` (`verified`): size then fingerprint, `corruptObject` otherwise. `meter`
 * counts its bytes as they arrive.
 */
export async function fetchVerified(
  url: string,
  announced: { bytes: number; sha256: string },
  signal?: AbortSignal,
  meter: ByteMeter = unmetered,
) {
  const buffer = await meter.read(await checked(url, signal), url).arrayBuffer()
  signal?.throwIfAborted()
  const own = await verified(announced, url, buffer)
  if (!own.buffer) throw own.refused
  return own.buffer
}
export async function loadClusterPages(
  pages: Array<{ url: string; bytes: number; sha256: string }>,
  base: string,
  signal: AbortSignal | undefined,
  progress: (loaded: number, total: number) => void,
  workerCount = 4,
) {
  const indices = new Map<string, Uint32Array>(),
    abort = new AbortController(),
    combined = signal ? AbortSignal.any([signal, abort.signal]) : abort.signal
  let next = 0,
    loaded = 0,
    pageBytesRead = 0
  const workers = Array.from(
    { length: Math.min(Math.max(1, workerCount), pages.length) },
    async () => {
      while (next < pages.length) {
        combined.throwIfAborted()
        const page = pages[next++]
        const buffer = await fetchVerified(new URL(page.url, base).href, page, combined)
        indices.set(page.url, new Uint32Array(buffer))
        pageBytesRead += buffer.byteLength
        progress(++loaded, pages.length)
      }
    },
  )
  try {
    await Promise.all(workers)
  } catch (error) {
    abort.abort(error instanceof Error ? error : String(error))
    await Promise.all(workers.map((worker) => worker.catch(() => {})))
    throw error
  }
  return { indices, loaded, pageBytesRead }
}
