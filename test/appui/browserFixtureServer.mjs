import { readFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// The served modules live in this folder, next to the server. It is the one that knows: a caller
// that recomputed the path kept it wrong after `browserFixtures/` moved to `appui/`.
const FIXTURES = dirname(fileURLToPath(import.meta.url));

/** Serve only the fixture modules owned by this test through the current browser origin. */
export async function routeBrowserFixtures(page, directory = FIXTURES) {
  const root = resolve(directory);
  await page.route('**/__wg-fixture/*.mjs', async (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    if (!name || !/^[A-Za-z][\w-]*\.mjs$/.test(name)) {
      await route.abort();
      return;
    }
    const file = resolve(root, name);
    if (!file.startsWith(root + sep)) {
      await route.abort();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'text/javascript',
      body: await readFile(file, 'utf8'),
    });
  });
}
