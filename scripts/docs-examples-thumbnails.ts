import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchChrome } from '../bench/runner/chrome.ts';
import { startDocsServer } from './docs-serve.ts';
import { leastDrawn, openExample, RENDER_ONLY, thumbnailDelay } from './docs/examples/capture.ts';
import { readyEntries } from '../site/app/examples/list.ts';

/**
 * Captures every example at the moment it declares (`thumbnailDelay`), one size for all, into
 * `site/assets/examples/thumbnails/<id>.png` — the cards of the Examples page. The render alone:
 * the example's panels and its credit line are hidden. An argument limits the run to one example.
 */
const site = resolve(import.meta.dirname, '../site'),
  out = resolve(site, 'assets/examples/thumbnails'),
  only = process.argv[2],
  entries = readyEntries.filter(({ id }) => !only || id === only);
await mkdir(out, { recursive: true });
const { server, port } = await startDocsServer();
const browser = await launchChrome({ headless: true });
try {
  for (const entry of entries) {
    // 16:10, sharp on a card at twice its size.
    const { page, errors, drawn } = await openExample(browser, port, entry, {
      width: 800,
      height: 500,
    });
    if (errors.length || drawn < leastDrawn(entry.id, true))
      throw new Error(`${entry.id}: ${errors.join('; ') || 'blank'}`);
    const html = await readFile(resolve(site, entry.file), 'utf8');
    await page.waitForTimeout(thumbnailDelay(html) * 1000);
    await page.locator('canvas#view').screenshot({
      path: resolve(out, `${entry.id}.png`),
      style: RENDER_ONLY,
    });
    await page.close();
    console.log(entry.id);
  }
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
