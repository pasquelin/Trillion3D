import { readFile } from 'node:fs/promises';
import type { Page } from 'playwright';
import { contentType, fileUnder } from '../../../scripts/static-server.ts';
import { stripTypes } from './staticServer.ts';

/** Serve only the fixture modules of `directory` through the current browser origin, their types
 *  stripped on the way out. The caller names the folder: it is the one that knows where its
 *  page modules live. */
export async function routeBrowserFixtures(page: Page, directory: string) {
  await page.route('**/__wg-fixture/*.ts', async (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    const file = name && /^[A-Za-z][\w-]*\.ts$/.test(name) ? fileUnder(directory, name) : null;
    if (file === null) return route.abort();
    const body = stripTypes(await readFile(file, 'utf8'), file);
    await route.fulfill({ status: 200, contentType: contentType('.js'), body });
  });
}
