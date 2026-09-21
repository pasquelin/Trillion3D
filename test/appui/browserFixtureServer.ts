import { readFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';
import type { Page } from 'playwright';

// The served modules live in this folder, next to the server. It is the one that knows: a caller
// that recomputed the path kept it wrong after `browserFixtures/` moved to `appui/`.
const FIXTURES = dirname(fileURLToPath(import.meta.url));

/** Serve only the fixture modules owned by this test through the current browser origin, their
 *  types stripped on the way out. */
export async function routeBrowserFixtures(page: Page, directory = FIXTURES) {
  const root = resolve(directory);
  await page.route('**/__wg-fixture/*.ts', async (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    if (!name || !/^[A-Za-z][\w-]*\.ts$/.test(name)) {
      await route.abort();
      return;
    }
    const file = resolve(root, name);
    if (!file.startsWith(root + sep)) {
      await route.abort();
      return;
    }
    const { code } = transformSync(await readFile(file, 'utf8'), {
      loader: 'ts',
      format: 'esm',
      target: 'es2022',
      sourcefile: file,
    });
    await route.fulfill({ status: 200, contentType: 'text/javascript', body: code });
  });
}
