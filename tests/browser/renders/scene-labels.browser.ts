// #1200: the public example draws text through scene sprites and its controls on both backends.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { launchChrome } from '../../../bench/runner/chrome.ts';
import { createDocsServer } from '../../../scripts/docs-serve.ts';
import { buildSite, SITE_OUTPUT } from '../../../scripts/docs/site.ts';
import { listen } from '../../../scripts/static-server.ts';
import { drawnShare, openExample } from '../../../scripts/docs/examples/capture.ts';

await buildSite();
const server = createDocsServer(SITE_OUTPUT, {
  transform(file) {
    if (!file.endsWith('/examples/labels-that-follow.html')) return;
    const html = readFileSync(file, 'utf8');
    const text = html.replace(
      /(const world = createWorld\([^;]*\);)/,
      '$1 globalThis.__labelRenderer = () => world.renderer;',
    );
    assert.notEqual(text, html, 'the proof observes the example world');
    return { type: 'text/html; charset=utf-8', text };
  },
});
const port = await listen(server, 0);
let browser: Awaited<ReturnType<typeof launchChrome>> | undefined;
try {
  browser = await launchChrome({ headless: true });
  for (const gpu of [true, false]) {
    const backend = gpu ? 'WebGPU' : 'WebGL2';
    const { page, errors, drawn } = await openExample(
      browser,
      port,
      { id: 'labels-that-follow', file: 'examples/labels-that-follow.html' },
      { width: 960, height: 600 },
      0.01,
      gpu,
    );
    try {
      assert.ok(drawn >= 0.01, `${backend}: the scene draws`);
      assert.equal(
        await page.evaluate(() =>
          (globalThis as { __labelRenderer?: () => string | null }).__labelRenderer?.(),
        ),
        gpu ? 'webgpu' : 'webgl2',
        `${backend}: the requested backend actually draws, without fallback`,
      );
      const select = page.locator('select');
      for (const choice of ['names only', 'year', 'moons', 'distance to the Sun']) {
        await select.selectOption(choice);
        await page.waitForTimeout(200);
        assert.ok((await drawnShare(page)) > 0, `${backend}: ${choice} keeps its scene`);
      }
      await page.getByRole('button', { name: 'Line them up', exact: true }).click();
      await page.waitForTimeout(500);
      assert.deepEqual(
        errors,
        [],
        `${backend}: labels and controls raise no page or console error`,
      );
    } finally {
      await page.close();
    }
  }
} finally {
  try {
    await browser?.close();
  } finally {
    server.close();
  }
}
