import assert from 'node:assert/strict';
import { resolve } from 'node:path';

/** Verify rendered documentation text at both widths; this portal has selectable code blocks. */
export async function startupSite(page, base, out) {
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(base + '/docs/index.html#guides/quick-start');
    const code = page.locator('main pre code').last();
    await code.waitFor();
    const text = await code.textContent();
    assert.match(text, /createExplorer\('viewer'/);
    assert.match(text, /interactive: true/);
    assert.match(text, /scope: 'full'/);
    assert.doesNotMatch(text, /querySelector|requestAnimationFrame/);
    await page.screenshot({
      path: resolve(out, `docs-${width}.png`),
      fullPage: true,
      animations: 'disabled',
    });
  }
  await page.goto(base + '/docs/index.html#browser/createExplorerJob');
  await page.locator('main pre code').filter({ hasText: 'createExplorerJob(' }).first().waitFor();
  const text = await page.locator('main').textContent();
  assert.match(text, /target: ExplorerTarget/);
  assert.match(text, /await createExplorerJob/);
}
