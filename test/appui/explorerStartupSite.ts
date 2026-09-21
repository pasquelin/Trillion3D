import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';

/** Verify the portal's line-based code blocks in both locales and at both widths. */
export async function startupSite(page, base, out) {
  await page.route('https://cdn.jsdelivr.net/npm/three@0.174.0/**', async (route) => {
    const file = route.request().url().split('three@0.174.0/')[1];
    await route.fulfill({
      contentType: 'text/javascript',
      body: await readFile(resolve(import.meta.dirname, '../../node_modules/three', file)),
    });
  });
  for (const locale of ['en', 'fr']) {
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`${base}/site/index.html#/${locale}/learn/quick-start`);
      const code = page.locator('main [data-code-block]').last();
      await code.waitFor();
      assert.equal(
        await page.evaluate(() =>
          [...document.styleSheets].some(
            (sheet) => sheet.href?.endsWith('/css/site.css') && sheet.cssRules.length > 0,
          ),
        ),
        true,
        'portal stylesheet is active',
      );
      const text = (await code.locator('pre code').allTextContents()).join('\n');
      assert.match(text, /createExplorer\('viewer'/);
      assert.match(text, /interactive: true/);
      assert.match(text, /scope: 'full'/);
      assert.doesNotMatch(text, /querySelector|requestAnimationFrame/);
      assert.match(await page.locator('main').textContent(), /interactive: true/);
      await page.screenshot({
        path: resolve(out, `docs-${locale}-${width}.png`),
        fullPage: true,
        animations: 'disabled',
      });
    }
    await page.goto(`${base}/site/index.html#/${locale}/api/createExplorerJob`);
    await page.locator('main [data-code-block]').last().waitFor();
    const text = await page.locator('main').textContent();
    assert.match(text, /target: ExplorerTarget/);
    assert.match(text, /await createExplorerJob/);
    await page.goto(`${base}/site/index.html#/${locale}/api/createExplorer`);
    await page.locator('main [data-code-block]').last().waitFor();
    const row = page.locator('main tr').filter({ hasText: 'invalidate()' });
    assert.match(await row.textContent(), /camera|caméra/);
  }
}
