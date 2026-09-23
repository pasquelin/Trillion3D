import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { BrowserContext, Page, Route } from 'playwright';

/** Where the portal loads Three from in production. */
export const THREE_CDN = 'https://cdn.jsdelivr.net/npm/three@0.174.0/';

/** Serves the portal's CDN copy of Three from `node_modules`: a proof never reaches the network. */
export async function routeThree(target: Page | BrowserContext): Promise<void> {
  await target.route(`${THREE_CDN}**`, async (route: Route) => {
    const file = route.request().url().slice(THREE_CDN.length);
    await route.fulfill({
      contentType: 'text/javascript',
      body: await readFile(resolve(import.meta.dirname, '../../../node_modules/three', file)),
    });
  });
}
