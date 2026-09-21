import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchChrome } from './mesure/chrome.ts';
import { startDocsServer } from './docs-serve.ts';
import { openExample } from './docs/examples/capture.ts';
import roadmap from '../site/content/gallery-roadmap.json' with { type: 'json' };

/**
 * Captures the settled render of every example that has a file, at the size of the lesson
 * previews, into `site/assets/examples/thumbnails/<id>.png` — the cards of the Examples page.
 * An argument limits the run to one example.
 */
const out = resolve(import.meta.dirname, '../site/assets/examples/thumbnails'),
  only = process.argv[2],
  entries = roadmap.entries.filter(({ id, file }) => file && (!only || id === only));
await mkdir(out, { recursive: true });
const { server, port } = await startDocsServer();
const browser = await launchChrome({ headless: true });
try {
  for (const entry of entries) {
    const { page, errors, drawn } = await openExample(browser, port, entry, {
      width: 916,
      height: 520,
    });
    if (errors.length || drawn < 0.1)
      throw new Error(`${entry.id}: ${errors.join('; ') || 'blank'}`);
    await page.addStyleTag({ content: 'p { display: none }' }); // The credit line stays on the page.
    await page.waitForTimeout(1500);
    await page.locator('canvas').screenshot({ path: resolve(out, `${entry.id}.png`) });
    await page.close();
    console.log(entry.id);
  }
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
