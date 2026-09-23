import assert from 'node:assert/strict';
import test from 'node:test';
import { launchChrome } from '../bench/runner/chrome.ts';
import { startDocsServer } from './docs-serve.ts';
import { openExample } from './docs/examples/capture.ts';
import roadmap from '../site/content/gallery-roadmap.json' with { type: 'json' };

const ready = roadmap.entries.filter(({ file }) => file);

test('every example file renders an image on its own, and the portal page fills with it', async () => {
  const { server, port } = await startDocsServer();
  const browser = await launchChrome({ headless: true });
  try {
    const [entry] = ready;
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`http://127.0.0.1:${port}/#/en/examples/${entry.id}`);
    const frame = page.locator('[data-demo] iframe');
    assert.equal(await frame.getAttribute('src'), entry.file);
    // The live render is the page: the iframe takes most of the height under the header.
    const view = await frame.boundingBox();
    assert.ok(view && view.height > 900 * 0.7, `the demo fills the content area (${view?.height})`);
    await page.close();
    // #276: with the machine's WebGPU device, then with none — a published example renders on
    // both, since it names no backend and the engine reads the machine it was opened on. Every
    // page is opened before the verdict, so the list names every example that stayed blank.
    const blank: string[] = [];
    for (const gpu of [true, false])
      for (const example of ready) {
        const opened = await openExample(
          browser,
          port,
          example,
          { width: 960, height: 600 },
          0.1,
          gpu,
        );
        if (opened.errors.length > 0 || opened.drawn < 0.1)
          blank.push(
            `${example.id} ${gpu ? 'with' : 'without'} WebGPU drew ${opened.drawn}${opened.errors[0] ? `: ${opened.errors[0]}` : ''}`,
          );
        await opened.page.close();
      }
    assert.deepEqual(blank, []);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
