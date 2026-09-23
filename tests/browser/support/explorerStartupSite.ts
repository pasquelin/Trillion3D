import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import type { Page } from 'playwright';
import { routeThree } from '../../kit/server/threeRoute.ts';

/** Verify the portal's line-based code blocks in both locales and at both widths. */
export async function startupSite(page: Page, base: string, out: string) {
  await routeThree(page);
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
      assert.match(text, /createWorld\('viewer'\)/);
      assert.match(text, /world\.scene\.load\('\/cache\/city\/manifest\.json'\)/);
      assert.doesNotMatch(text, /querySelector|requestAnimationFrame/);
      assert.match(
        (await page.locator('main').textContent()) ?? '',
        /pauses once the image has held|se met en pause une fois l’image tenue/,
      );
      await page.screenshot({
        path: resolve(out, `docs-${locale}-${width}.png`),
        fullPage: true,
        animations: 'disabled',
      });
    }
    await page.goto(`${base}/site/index.html#/${locale}/api/createWorld`);
    await page.locator('main [data-code-block]').last().waitFor();
    assert.match((await page.locator('main').textContent()) ?? '', /createWorld\(target: /);
    const row = page.locator('main tr').filter({ hasText: 'invalidate()' });
    assert.match((await row.textContent()) ?? '', /draw again|redessiner/);
  }
}
