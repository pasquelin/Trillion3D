import { cpuNow, msSince } from '../../diagnostic/stopwatch.ts'
import {
  createPageIntegrationPlan,
  planPageIntegration,
} from '../../../../sdk-core/src/page/integrationPlan.ts'
import {
  PAGE_INTEGRATION_PROTOCOL,
  PAGE_SLICE_STRIDE,
  PAGE_SPEC_STRIDE,
} from '../../../../sdk-core/src/page/integrationContracts.ts'
import type {
  PageIntegrationAnswer,
  PageIntegrationRequest,
} from '../../../../sdk-core/src/page/integrationContracts.ts'
import type { PageIntegrationPlan } from '../../../../sdk-core/src/page/integrationPlan.ts'

/**
 * Integration-contract task, once for both transports: the worker runs it on its thread, the
 * fallback runs it on the main thread, and both return the same answer.
 *
 * The runner keeps the card of each address: it depends only on the catalogue, so the second
 * arrival of the same request has only an integer left to send. An arrival whose card is
 * missing is refused rather than guessed — the caller then falls back in-line, with its own.
 */
export function createPageIntegrationRunner() {
  const specsByUrl = new Map<string, Int32Array>()
  /** One plan, reused: the answer copies the buffers to their size to transfer them. */
  let plan: PageIntegrationPlan | undefined

  const run = (request: PageIntegrationRequest): PageIntegrationAnswer => {
    const started = cpuNow()
    if (request.specs) specsByUrl.set(request.url, new Int32Array(request.specs))
    const specs = specsByUrl.get(request.url)
    if (!specs)
      return {
        protocol: PAGE_INTEGRATION_PROTOCOL,
        id: request.id,
        ok: false,
        url: request.url,
        code: 'PAGE_INTEGRATION_UNKNOWN',
        message: 'PAGE_INTEGRATION_UNKNOWN',
      }
    const records = (specs.length / PAGE_SPEC_STRIDE) | 0
    if (!plan || plan.pages.length < records) plan = createPageIntegrationPlan(records)
    planPageIntegration(specs, request.words, plan)
    const slices = plan.slices.slice(0, plan.count * PAGE_SLICE_STRIDE),
      pages = plan.pages.slice(0, plan.pageCount)
    return {
      protocol: PAGE_INTEGRATION_PROTOCOL,
      id: request.id,
      ok: true,
      url: request.url,
      slices: slices.buffer as ArrayBuffer,
      count: plan.count,
      pages: pages.buffer as ArrayBuffer,
      pageCount: plan.pageCount,
      taskMs: msSince(started),
    }
  }

  /** Buffers an answer yields to its recipient, in the order the message carries them. */
  const transferOf = (answer: PageIntegrationAnswer) =>
    answer.ok ? [answer.slices, answer.pages] : []

  return { run, transferOf }
}
