// A blank page served from this repository in system Chrome — the harness mounts, `dist/`,
// `tests/` and the engine sources the page modules import by relative path —, for a proof or a
// fixture that imports its module in the page and runs it there. Nothing outside the repository
// is read; the browser and the server are closed whatever `use` does.
import { resolve } from 'node:path';
import type { Page } from 'playwright';
import { launchChrome } from '../../../bench/runner/chrome.ts';
import { resolveMounts } from '../../../bench/runner/options.ts';
import { startServer, serverPort } from './staticServer.ts';

/** Runs `use` on the page; returns what it returned and the errors the page threw. */
export async function withRepoPage<T>(
  root: string,
  headless: boolean,
  use: (page: Page) => Promise<T>,
): Promise<{ result: T; pageErrors: string[] }> {
  const mounts = [
    ...resolveMounts(root, []),
    { prefix: '/dist/', dir: resolve(root, 'dist') },
    { prefix: '/tests/', dir: resolve(root, 'tests') },
    { prefix: '/packages/', dir: resolve(root, 'packages') },
  ];
  const server = await startServer({ port: 0, mounts, captures: new Map() });
  const browser = await launchChrome({ headless }).catch((error: unknown) => {
    server.close();
    throw error;
  });
  try {
    const page = await browser.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') console.error(message.text());
    });
    await page.goto(`http://127.0.0.1:${serverPort(server)}/`);
    return { result: await use(page), pageErrors };
  } finally {
    await browser.close();
    server.close();
  }
}
