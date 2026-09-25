// A blank page served from this repository in system Chrome — the harness mounts, then the
// repository itself, whose files the page modules import by relative path —, for a proof or a
// fixture that imports its module in the page and runs it there. Nothing outside the repository
// is read; the browser and the server are closed whatever `use` does.
import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import { launchChrome } from '../../../bench/runner/chrome.ts';
import { resolveMounts } from '../../../bench/runner/options.ts';
import { startServer } from './staticServer.ts';

/** Runs `use` on the page and returns what it returned; fails when the page threw, since a
 *  reading taken past an error is none. */
export async function withRepoPage<T>(
  root: string,
  headless: boolean,
  use: (page: Page) => Promise<T>,
): Promise<T> {
  const mounts = [...resolveMounts(root, []), { prefix: '/', dir: root }];
  const { server, port } = await startServer({ mounts });
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
    await page.goto(`http://127.0.0.1:${port}/`);
    const result = await use(page);
    assert.deepEqual(pageErrors, [], `the page threw:\n${pageErrors.join('\n')}`);
    return result;
  } finally {
    await browser.close();
    server.close();
  }
}
