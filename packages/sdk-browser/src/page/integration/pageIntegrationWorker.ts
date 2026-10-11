import { PAGE_INTEGRATION_PROTOCOL } from '../../../../sdk-core/src/index.ts'
import { createPageIntegrationRunner } from './task.ts'
import type { PageIntegrationRequest } from '../../../../sdk-core/src/index.ts'
import { type WorkerScope } from '../../host/workerScope.ts'

/**
 * Entry point of the page-integration worker. Platform adapter: this file is loaded only in a
 * module `Worker`, it takes no decision, and it never sees a page's bytes — only the request's
 * card and the arrived packet's length.
 *
 */
const scope = globalThis as unknown as WorkerScope
const runner = createPageIntegrationRunner()

scope.onmessage = (event) => {
  const request = event.data as PageIntegrationRequest
  if (!request || request.protocol !== PAGE_INTEGRATION_PROTOCOL) return
  const answer = runner.run(request)
  scope.postMessage(answer, runner.transferOf(answer))
}
