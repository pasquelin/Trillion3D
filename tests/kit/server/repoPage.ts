// A blank page served from this repository in system Chrome, for a proof or a fixture that
// imports its module in the page and runs it there (`repoServer`). Nothing outside the repository
// is read; the browser and the server are closed whatever `use` does.
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import type { Page } from 'playwright';
import { launchChrome } from '../../../bench/runner/chrome.ts';
import { resolveMounts } from '../../../bench/runner/options.ts';
import { startServer } from './staticServer.ts';

/**
 * Import-map entries sending each engine source the build emitted, by its address under
 * `/packages/`, to its file under `/dist/`. A page module imports engine sources by relative path
 * (the graph fixtures, the maths) while the page loads the engine from `dist/`: without them each
 * such module would run twice, and two scene states refuse each other's nodes ("Scene nodes belong
 * to different roots", #795). A fixture, which the build leaves out, runs from its source, once.
 */
function engineInDist(root: string) {
  const imports: Record<string, string> = {};
  assert.ok(existsSync(resolve(root, 'dist')), 'dist missing: run `pnpm run build` first');
  for (const file of readdirSync(resolve(root, 'dist'), { recursive: true, encoding: 'utf8' })) {
    const emitted = file.split(sep).join('/');
    const source = emitted.replace(/\.js$/, '.ts').replace(/\.mjs$/, '.mts');
    if (source !== emitted && existsSync(resolve(root, 'packages', source)))
      imports[`/packages/${source}`] = `/dist/${emitted}`;
  }
  return imports;
}

/** The server of a repository page: the harness mounts, `dist/`, `tests/`, `scripts/` and the
 *  engine sources, each emitted one resolved to `dist/` (`engineInDist`). */
export const repoServer = (root: string) =>
  startServer({
    mounts: [
      ...resolveMounts(root, []),
      { prefix: '/dist/', dir: resolve(root, 'dist') },
      { prefix: '/tests/', dir: resolve(root, 'tests') },
      { prefix: '/scripts/', dir: resolve(root, 'scripts') },
      { prefix: '/packages/', dir: resolve(root, 'packages') },
    ],
    imports: engineInDist(root),
  });

/** Runs `use` on the page and returns what it returned; fails when the page threw, since a
 *  reading taken past an error is none. */
export async function withRepoPage<T>(
  root: string,
  headless: boolean,
  use: (page: Page) => Promise<T>,
): Promise<T> {
  const { server, port } = await repoServer(root);
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
