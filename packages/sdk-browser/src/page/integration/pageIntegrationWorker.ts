import { PAGE_INTEGRATION_PROTOCOL } from '../../../../sdk-core/src/index.ts';
import { createPageIntegrationRunner } from './task.ts';
import type { PageIntegrationRequest } from '../../../../sdk-core/src/index.ts';

/**
 * Entry point of the page-integration worker. Platform adapter: this file is loaded only in a
 * module `Worker`, it takes no decision, and it never sees a page's bytes — only the request's
 * card and the arrived packet's length.
 *
 * A dedicated worker's scope is not typed by the repository's DOM library; the minimal shape
 * this file needs is declared here rather than adding a whole library.
 */
type IntegrationWorkerScope = {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage(message: unknown, transfer: ArrayBuffer[]): void;
};

const scope = globalThis as unknown as IntegrationWorkerScope;
const runner = createPageIntegrationRunner();

scope.onmessage = (event) => {
  const request = event.data as PageIntegrationRequest;
  if (!request || request.protocol !== PAGE_INTEGRATION_PROTOCOL) return;
  const answer = runner.run(request);
  scope.postMessage(answer, runner.transferOf(answer));
};
