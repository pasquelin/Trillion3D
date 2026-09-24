import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import type { Page } from 'playwright';
import { routeThree } from '../../kit/server/threeRoute.ts';

/** Verify the first chapter's code in both locales and at both widths, then the createWorld and
 *  world.invalidate entries. */
export async function startupSite(page: Page, base: string, out: string) {
  await routeThree(page);
  for (const locale of ['en', 'fr']) {
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`${base}/site/index.html#/${locale}/learn/create-a-world`);
      // A hash change keeps the last page on screen until the chapter renders: wait for its code.
      await page.locator('main pre code', { hasText: "createWorld('view'" }).first().waitFor();
      assert.equal(
        await page.evaluate(() =>
          [...document.styleSheets].some(
            (sheet) => sheet.href?.endsWith('/css/site.css') && sheet.cssRules.length > 0,
          ),
        ),
        true,
        'portal stylesheet is active',
      );
      const text = (await page.locator('main pre code').allTextContents()).join('\n');
      assert.match(text, /createWorld\('view', \{ controls: 'orbit' \}\)/);
      assert.doesNotMatch(text, /querySelector|requestAnimationFrame/);
      assert.match(
        (await page.locator('main').textContent()) ?? '',
        /Next chapter — Add a shape|Chapitre suivant — Ajouter une forme/,
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
    // The world's methods are entries of their own since the portal's reference was regrouped.
    await page.goto(`${base}/site/index.html#/${locale}/api/world.invalidate`);
    await page.locator('main [data-code-block]').first().waitFor();
    assert.match(
      (await page.locator('main').textContent()) ?? '',
      /Asks for a new frame|Demande une nouvelle image/,
    );
  }
}
