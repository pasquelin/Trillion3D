// A blank page served from this repository in system Chrome, for a proof or a fixture that
// imports its module in the page and runs it there (`repoServer`). Nothing outside the repository
// is read; the browser and the server are closed whatever `use` does.
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import type { Page } from 'playwright';
import { launchChrome } from '../../../bench/runner/chrome.ts';
import { resolveMounts } from '../../../bench/runner/options.ts';
import { emittedOf, engineSources } from '../../../scripts/engine-dist.ts';
import { startServer } from './staticServer.ts';

/**
 * Import-map entries sending each engine source the build emitted, by its address under
 * `/packages/`, to its file under `/dist/`. A page module imports engine sources by relative path
 * (the graph fixtures, the maths) while the page loads the engine from `dist/`: without them each
 * such module would run twice, and two scene states refuse each other's nodes ("Scene nodes belong
 * to different roots", #795). A fixture, which the build leaves out, runs from its source, once. A
 * build older than a source is refused: the page would run another engine than the sources say.
 */
function engineInDist(root: string) {
  const address = (file: string) => `/${relative(root, file).split(sep).join('/')}`;
  const imports: Record<string, string> = {};
  const stale: string[] = [];
  for (const source of engineSources()) {
    const emitted = emittedOf(source);
    const built = statSync(emitted, { throwIfNoEntry: false })?.mtimeMs;
    if (built === undefined) continue;
    if (built < statSync(source).mtimeMs) stale.push(relative(root, source));
    imports[address(source)] = address(emitted);
  }
  if (stale.length)
    assert.fail(`dist older than ${stale.join(', ')}: run \`pnpm run build\` first`);
  return imports;
}

/** The server of a repository page: the harness mounts, `dist/`, `tests/`, `scripts/` and the
 *  engine sources, each emitted one resolved to `dist/` (`engineInDist`). */
export function repoServer(root: string) {
  assert.ok(
    existsSync(resolve(root, 'dist/witnesses/measurement.js')),
    'dist missing: run `pnpm run build` first',
  );
  return startServer({
    mounts: [
      ...resolveMounts(root, []),
      { prefix: '/dist/', dir: resolve(root, 'dist') },
      { prefix: '/tests/', dir: resolve(root, 'tests') },
      { prefix: '/scripts/', dir: resolve(root, 'scripts') },
      { prefix: '/packages/', dir: resolve(root, 'packages') },
    ],
    imports: engineInDist(root),
  });
}

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
