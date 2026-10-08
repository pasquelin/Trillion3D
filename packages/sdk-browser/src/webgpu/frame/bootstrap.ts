import { pageRequestUrl, type PageRec } from '../../page/selection/selection.ts'
import { pageAddress } from '../row/pageSlots.ts'
import type { createGpuPageCache } from '../../gpu/page/pages.ts'
import type { createWebgpuDiagnostics } from '../pages/io/diagnostics.ts'
import type { createWebgpuPageTracking } from '../row/pageTracking.ts'

type Cache = ReturnType<typeof createGpuPageCache>
type Diagnostics = ReturnType<typeof createWebgpuDiagnostics>
type Tracking = ReturnType<typeof createWebgpuPageTracking>
type BootstrapOptions = {
  pages: PageRec[]
  getSlots: () => number
  tracking: Tracking
  signal?: AbortSignal
  readPage?: (url: string) => Promise<Uint32Array>
  acceptPage: (url: string, data: Uint32Array) => void
  getCache: () => Cache | undefined
  getFrame: () => number
  isLost: () => boolean
  hasBytes: (page: PageRec) => boolean
  engineDiagnostic: Diagnostics['engineDiagnostic']
  traceDiagnostic: Diagnostics['traceDiagnostic']
  diagnosticFailure: Diagnostics['diagnosticFailure']
}

/** Pins the complete fallback cover before the first WebGPU image is rendered. */
export function createWebgpuBootstrap(options: BootstrapOptions) {
  const { pages, readPage, hasBytes, diagnosticFailure } = options
  let ready = false,
    loading: Promise<void> | undefined
  const ensure = async () => {
    if (ready) return
    if (loading) return loading
    if (pages.some((page) => !hasBytes(page)) && !readPage) return
    loading = loadCover(options, () => {
      ready = true
    })
      .catch((error) => {
        diagnosticFailure('coverage-bootstrap-failed', error)
        throw error
      })
      .finally(() => {
        loading = undefined
      })
    return loading
  }
  return {
    ensure,
    get ready() {
      return ready
    },
  }
}

/** The cover read, uploaded and pinned, `onReady` told before the diagnostics say so. */
async function loadCover(options: BootstrapOptions, onReady: () => void) {
  const { pages, getSlots, tracking, getFrame, engineDiagnostic, traceDiagnostic } = options
  const started = performance.now()
  engineDiagnostic('coverage-bootstrap-start', 'Loading the full emergency cover', {
    version: 1,
    pages: pages.length,
    slots: getSlots(),
  })
  traceDiagnostic('coverage-bootstrap-start', 'Loading the full emergency cover', () => ({
    frame: getFrame(),
    pages: pages.length,
    pageIds: tracking.pageRefs(pages.map(pageAddress)),
    slots: getSlots(),
    queueWaitMs: 0,
  }))
  await readMissing(options)
  await pinCover(options)
  onReady()
  engineDiagnostic('coverage-bootstrap-ready', 'Full cover available on the GPU', {
    version: 1,
    pages: pages.length,
    slots: getSlots(),
  })
  traceDiagnostic('coverage-bootstrap-ready', 'Full cover available on the GPU', () => ({
    frame: getFrame(),
    pages: pages.length,
    bootstrap: tracking.traceSet('bootstrap', pages.map(pageAddress)),
    slots: getSlots(),
    durationMs: performance.now() - started,
    loaded: tracking.traceRecs('bootstrap.loaded', pages),
    wanted: tracking.traceRecs('bootstrap.wanted', pages),
  }))
}

/** The cover pages without their bytes read, eight at a time; the first failure is thrown. */
async function readMissing(options: BootstrapOptions) {
  const { pages, signal, readPage, acceptPage, isLost, hasBytes } = options
  let next = 0
  const workers = Array.from({ length: Math.min(8, pages.length) }, async () => {
    while (next < pages.length) {
      const page = pages[next++]
      signal?.throwIfAborted()
      if (isLost()) throw new Error('WEBGPU_LOST')
      if (!hasBytes(page)) {
        const key = pageRequestUrl(page)
        const data = await readPage!(key)
        signal?.throwIfAborted()
        if (isLost()) throw new Error('WEBGPU_LOST')
        acceptPage(key, data)
      }
    }
  })
  const results = await Promise.allSettled(workers)
  const failed = results.find((result) => result.status === 'rejected')
  if (failed?.status === 'rejected') throw failed.reason
}

/**
 * Every cover page is asked for at once, then awaited in order: a page whose bytes the cache must
 * still read starts that read immediately instead of waiting for the previous page's round trip,
 * and the cache's own queue keeps the uploads in order and bounded.
 */
async function pinCover(options: BootstrapOptions) {
  const { pages, tracking, signal, getCache, isLost } = options
  const loads = pages.map((page) => {
    const job = getCache()!.load(pageAddress(page), signal, 'held')
    job.catch(() => {})
    return job
  })
  for (let i = 0; i < pages.length; i++) {
    signal?.throwIfAborted()
    if (isLost()) throw new Error('WEBGPU_LOST')
    // Held on arrival, inside the cache's queue: a resize queued meanwhile cannot evict it.
    await loads[i]
    tracking.markPinned(tracking.keyOf(pages[i]))
  }
}
