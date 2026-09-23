import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import type { Page } from 'playwright';
import { stripTypes } from './staticServer.ts';

/** Serve only the fixture modules of `directory` through the current browser origin, their types
 *  stripped on the way out. The caller names the folder: it is the one that knows where its
 *  page modules live. */
export async function routeBrowserFixtures(page: Page, directory: string) {
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
    const body = stripTypes(await readFile(file, 'utf8'), file);
    await route.fulfill({ status: 200, contentType: 'text/javascript', body });
  });
}
