import { besideModule, startModuleWorker } from '../../host/besideModule.ts'
import { PAGE_INTEGRATION_PROTOCOL } from '../../../../sdk-core/src/index.ts'
import type {
  PageIntegrationAnswer,
  PageIntegrationRequest,
} from '../../../../sdk-core/src/index.ts'

const workerError = (id: number, url: string): PageIntegrationAnswer => ({
  protocol: PAGE_INTEGRATION_PROTOCOL,
  id,
  ok: false,
  url,
  code: 'PAGE_INTEGRATION_WORKER',
  message: 'PAGE_INTEGRATION_WORKER',
})

/**
 * One worker, one queue, send order kept intact. Browser adapter: this is the only integration
 * file that constructs a `Worker`.
 *
 * One thread, not a pool: the integration order IS the frame's priority, and two threads would
 * return their plans in the order of their load. The work planned here is integer arithmetic
 * on a few hundred records; it is the main thread that must be freed, not one more core that
 * must be occupied.
 *
 * `start` is the startup gate: a probe request goes first, and a start that fails — no
 * `Worker`, module not found — leaves the caller to its in-line fallback. After start, the
 * worker's disappearance breaks the queue: in-flight work answers `PAGE_INTEGRATION_WORKER`,
 * and everything after that goes back in-line.
 */
export function createPageIntegrationLane() {
  const lane: Lane = {
    pending: new Map(),
    worker: undefined,
    alive: true,
    nextId: 1,
    ready: undefined,
  }
  const source = besideModule('pageIntegrationWorker', import.meta.url)
  const retire = () => breakLane(lane)
  return {
    get alive() {
      return lane.alive
    },
    /** True once the worker has answered the startup probe; false and the queue closed otherwise. */
    start() {
      lane.ready ??= startLane(lane, source)
      return lane.ready
    },
    submit: (url: string, words: number, specs: ArrayBuffer | null) =>
      submit(lane, url, words, specs),
    retire,
  }
}

/** What a lane holds: the answers awaited, its worker, whether it runs, the next request's id,
 *  and its startup. */
type Lane = {
  pending: Map<number, (answer: PageIntegrationAnswer) => void>
  worker: Worker | undefined
  alive: boolean
  nextId: number
  ready: Promise<boolean> | undefined
}

function breakLane(lane: Lane) {
  if (!lane.alive) return
  lane.alive = false
  const lost = [...lane.pending.entries()]
  lane.pending.clear()
  lane.worker?.terminate()
  lane.worker = undefined
  for (const [id, settle] of lost) settle(workerError(id, ''))
}

function spawn(lane: Lane, source: ReturnType<typeof besideModule>) {
  const spawned = startModuleWorker(source)
  spawned.onmessage = (event: MessageEvent) => {
    const answer = event.data as PageIntegrationAnswer
    const settle = lane.pending.get(answer.id)
    lane.pending.delete(answer.id)
    settle?.(answer)
  }
  const broken = () => breakLane(lane)
  spawned.onerror = broken
  spawned.onmessageerror = broken
  return spawned
}

function submit(lane: Lane, url: string, words: number, specs: ArrayBuffer | null) {
  const request: PageIntegrationRequest = {
    protocol: PAGE_INTEGRATION_PROTOCOL,
    id: lane.nextId++,
    url,
    words,
    specs,
  }
  const { worker } = lane
  if (!lane.alive || !worker) return Promise.resolve(workerError(request.id, url))
  return new Promise<PageIntegrationAnswer>((resolve) => {
    lane.pending.set(request.id, resolve)
    try {
      worker.postMessage(request, specs ? [specs] : [])
    } catch {
      breakLane(lane)
    }
  })
}

/** The startup probe: the worker spawned and asked once; false, the lane broken, when it fails. */
async function startLane(lane: Lane, source: ReturnType<typeof besideModule>) {
  if (typeof Worker === 'undefined') {
    breakLane(lane)
    return false
  }
  try {
    lane.worker = spawn(lane, source)
    const answer = await submit(lane, '', 0, new Int32Array(0).buffer as ArrayBuffer)
    if (!answer.ok) breakLane(lane)
    return answer.ok
  } catch {
    breakLane(lane)
    return false
  }
}
