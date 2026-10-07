import type { PageSource } from '../../../../sdk-core/src/index.ts'
import { refusedStatus } from '../../cluster/checked.ts'
import type { EngineDiagnostic } from '../../engine/types.ts'
import { lazyDiagnostic } from '../../diagnostic/engineDiagnostic.ts'

export function createGpuPageReader(
  source: PageSource,
  pageBytes: number,
  diagnostic: ((diagnostic: EngineDiagnostic) => void) | undefined,
  fetches: Map<string, Promise<Uint8Array>>,
) {
  const report = typeof diagnostic === 'function' ? diagnostic : undefined
  const emit = lazyDiagnostic(report)
  const now = () => (report ? performance.now() : 0)
  const rd: Reader = { source, pageBytes, fetches, report, emit, now, asked: new WeakMap() }
  const readBytes = (key: string, combined: AbortSignal, attempt: number, priority?: number) =>
    readBytesOf(rd, key, combined, attempt, priority)
  const fetchBytes = (key: string, combined: AbortSignal, priority?: number) =>
    fetchBytesOf(rd, key, combined, priority)
  return { report, emit, now, readBytes, fetchBytes }
}

type Reader = {
  source: PageSource
  pageBytes: number
  fetches: Map<string, Promise<Uint8Array>>
  report: ((diagnostic: EngineDiagnostic) => void) | undefined
  emit: ReturnType<typeof lazyDiagnostic>
  now: () => number
  /** The priority each read still in flight was asked at, when one was given. */
  asked: WeakMap<Promise<Uint8Array>, number>
}

function readBytesOf(
  rd: Reader,
  key: string,
  combined: AbortSignal,
  attempt: number,
  priority: number | undefined,
) {
  const started = rd.now()
  rd.emit?.('gpu-page-read-start', 'GPU page read started', () => ({
    version: 1,
    key,
    attempt,
  }))
  rd.emit?.('gpu-page-attempt-start', 'GPU page read attempt', () => ({
    version: 1,
    key,
    attempt,
    maxAttempts: 2,
  }))
  let raw: Promise<Uint8Array>
  try {
    raw = rd.source.read(key, combined, priority)
  } catch (error) {
    raw = Promise.reject(error)
  }
  const job = Promise.resolve(raw).then(
    (bytes) => readEnded(rd, key, attempt, started, bytes),
    (error) => readFailed(rd, key, attempt, started, error),
  )
  return job
}

function readEnded(rd: Reader, key: string, attempt: number, started: number, bytes: Uint8Array) {
  const { emit, report, pageBytes } = rd
  emit?.('gpu-page-read-end', 'GPU page read finished', () => ({
    version: 1,
    key,
    attempt,
    status: null,
    expectedBytes: pageBytes,
    actualBytes: bytes.byteLength,
    durationMs: report ? performance.now() - started : null,
  }))
  emit?.('gpu-page-attempt-end', 'GPU read attempt succeeded', () => ({
    version: 1,
    key,
    attempt,
    status: null,
    expectedBytes: pageBytes,
    actualBytes: bytes.byteLength,
    durationMs: report ? performance.now() - started : null,
  }))
  return bytes
}

function readFailed(
  rd: Reader,
  key: string,
  attempt: number,
  started: number,
  error: unknown,
): never {
  const { emit, report } = rd
  emit?.('gpu-page-read-end', 'GPU page read failed', () => ({
    version: 1,
    key,
    attempt,
    status: refusedStatus(error),
    error: String(error),
    durationMs: report ? performance.now() - started : null,
  }))
  emit?.('gpu-page-attempt-end', 'GPU read attempt failed', () => ({
    version: 1,
    key,
    attempt,
    status: refusedStatus(error),
    error: String(error),
    durationMs: report ? performance.now() - started : null,
  }))
  throw error
}

function fetchBytesOf(
  rd: Reader,
  key: string,
  combined: AbortSignal,
  priority: number | undefined,
) {
  const { fetches, asked } = rd
  const existing = fetches.get(key)
  if (existing) {
    rd.emit?.('gpu-page-read-coalesced', 'GPU read joined to an in-flight request', () => ({
      version: 1,
      key,
      loading: fetches.size,
    }))
    // A more urgent read joining a prefetch asks the source too: its streamer raises the job
    // it joins, and the view's loading total counts the page it now waits on (#408).
    const was = asked.get(existing)
    if (was !== undefined && (priority === undefined || priority < was)) {
      if (priority === undefined) asked.delete(existing)
      else asked.set(existing, priority)
      try {
        void Promise.resolve(rd.source.read(key, combined, priority)).catch(() => {})
      } catch {
        /* The read in flight reports its own failure. */
      }
    }
    return existing
  }
  const job = readBytesOf(rd, key, combined, 1, priority)
  fetches.set(key, job)
  if (priority !== undefined) asked.set(job, priority)
  void job.finally(() => asked.delete(job)).catch(() => {})
  return job
}
