// `runInstalledWorkers` runs inside the browser page (`page.evaluate`): DOM Worker, MessageEvent
// and fetch are ambient, and nothing it imports survives the trip. The messages are therefore
// built here, in Node, from the engine's own contracts, and handed to it as arguments.
import {
  PAGE_INTEGRATION_PROTOCOL,
  type PageIntegrationRequest,
} from '../../packages/sdk-core/src/index.ts'
import {
  PAGE_TASK_PROTOCOL,
  type PageTaskRequest,
} from '../../packages/sdk-core/src/page/taskContracts.ts'

/** The messages the installed workers receive, minus the buffers the page makes and transfers. */
export interface InstalledWorkerRequests {
  /** The cell file's bytes travel as numbers: `page.evaluate` carries no buffer. */
  page: Omit<PageTaskRequest, 'source'> & { source: number[] }
  integration: Omit<PageIntegrationRequest, 'specs'> & { specs: number[] }
}

/** A partition cell file of one node, the smallest task the page worker reads whole. */
const ONE_CELL = JSON.stringify({
  version: 2,
  nodes: [
    { parent: null, mesh: 0, matrix: null, translation: [7, 10, 15], rotation: null, scale: null },
  ],
})

/** One cell file read by the page worker, and one arrival of a single-page, one-triangle sheet. */
export function installedWorkerRequests(): InstalledWorkerRequests {
  return {
    page: {
      protocol: PAGE_TASK_PROTOCOL,
      id: 1,
      op: 'cells',
      name: 'installed-proof.cells',
      source: [...new TextEncoder().encode(ONE_CELL)],
    },
    integration: {
      protocol: PAGE_INTEGRATION_PROTOCOL,
      id: 1,
      url: 'installed-proof',
      words: 3,
      specs: [0, 1, 7],
    },
  }
}

/** The page worker's response message, read once at the boundary where it arrives. */
export interface PageWorkerResult {
  ok: boolean
  cells?: { nodes: number }
  taskMs?: number
}

/** The integration worker's response message, read once at the boundary where it arrives. */
export interface IntegrationWorkerResult {
  ok: boolean
  count?: number
  pageCount?: number
  taskMs?: number
}

export async function runInstalledWorkers({
  pageWorkerUrl,
  integrationWorkerUrl,
  requests,
}: {
  pageWorkerUrl: string
  integrationWorkerUrl: string
  requests: InstalledWorkerRequests
}): Promise<{ page: PageWorkerResult; integration: IntegrationWorkerResult }> {
  const run = <T>(
    workerUrl: string,
    request: Record<string, unknown>,
    transfer: Transferable[],
  ): Promise<T> => {
    const worker = new Worker(workerUrl, { type: 'module' })
    return new Promise<T>((resolve, reject) => {
      const finish = <V>(settle: (value: V) => void, value: V): void => {
        clearTimeout(timeout)
        worker.terminate()
        settle(value)
      }
      const timeout = setTimeout(
        () => finish(reject, new Error(`installed worker timed out: ${workerUrl}`)),
        30_000,
      )
      worker.onerror = (event) =>
        finish(reject, new Error(`installed worker failed: ${workerUrl}: ${event.message}`))
      worker.onmessageerror = () =>
        finish(reject, new Error(`installed worker message failed: ${workerUrl}`))
      worker.onmessage = ({ data }: MessageEvent<T>) => finish(resolve, data)
      try {
        worker.postMessage(request, transfer)
      } catch (error) {
        finish(reject, error)
      }
    })
  }
  const source = new Uint8Array(requests.page.source).buffer
  const page = await run<PageWorkerResult>(pageWorkerUrl, { ...requests.page, source }, [source])
  const specs = new Int32Array(requests.integration.specs)
  const integration = await run<IntegrationWorkerResult>(
    integrationWorkerUrl,
    { ...requests.integration, specs: specs.buffer },
    [specs.buffer],
  )
  return { page, integration }
}
