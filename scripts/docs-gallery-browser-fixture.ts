// Shared Chrome + docs-server pairing for the gallery browser proofs that mount more than one
// page against the same server (cold load, startup deadline): open once, close both together.
import { launchChrome } from './mesure/chrome.ts';
import { startDocsServer } from './docs-serve.ts';

export async function openDocsBrowser() {
  const { server, port } = await startDocsServer();
  const browser = await launchChrome({ headless: true });
  return {
    port,
    browser,
    close: async () => {
      await browser.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
