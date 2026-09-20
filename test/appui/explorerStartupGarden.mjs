import assert from 'node:assert/strict';
import { resolve } from 'node:path';

/** Exercise the actual portal lifecycle; counters observe engine frames without drawing. */
export async function startupGarden(page, base, out) {
  await page.addInitScript(() => {
    const request = window.requestAnimationFrame.bind(window);
    window.startupFrames = 0;
    window.requestAnimationFrame = (callback) => {
      window.startupFrames++;
      return request(callback);
    };
  });
  await page.goto('about:blank');
  for (const locale of ['en', 'fr']) {
    await page.setViewportSize({ width: locale === 'en' ? 1280 : 390, height: 800 });
    await page.goto(`${base}/docs/index.html#/${locale}/examples/engine-scene`);
    const mode = page.locator('[data-scene-mode]');
    await page
      .waitForFunction(
        () => {
          const control = document.querySelector('[data-scene-mode]');
          return control && !control.disabled;
        },
        undefined,
        { timeout: 60000 },
      )
      .catch(async (error) => {
        throw new Error(
          `Garden startup: ${await page.locator('[data-scene-status]').textContent()}`,
          { cause: error },
        );
      });
    const idle = async () => {
      await page.evaluate(() => {
        window.startupQuiet = null;
      });
      await page.waitForFunction(
        () => {
          const frames = window.startupFrames,
            now = performance.now();
          if (window.startupQuiet?.frames !== frames) {
            window.startupQuiet = { frames, since: now };
            return false;
          }
          return (
            now - window.startupQuiet.since >= 600 &&
            /No recent frame|Aucune image récente/.test(
              document.querySelector('[data-scene-fps]')?.textContent ?? '',
            )
          );
        },
        undefined,
        { polling: 100, timeout: 60000 },
      );
    };
    await idle();
    const number = async (name) =>
      Number((await page.locator(`[data-scene-${name}]`).textContent()).replace(/\D/g, ''));
    assert.equal(await number('selected'), 35840);
    assert.equal(await number('drawn'), 35840);
    const code = (await page.locator('[data-code-block] pre code').allTextContents()).join('\n');
    assert.match(code, /createExplorer\('garden'/);
    assert.match(code, /interactive: true/);
    assert.doesNotMatch(code, /querySelector|requestAnimationFrame|ResizeObserver/);
    for (const view of [
      'clusters',
      'pages',
      'wireframe',
      'lod',
      'screen-error',
      'visibility',
      'beauty',
    ]) {
      if (await mode.locator(`option[value="${view}"]`).isDisabled()) continue;
      await mode.selectOption(view);
      await idle();
    }
    await page.locator('[data-scene-zoom-in]').click();
    await idle();
    await page.locator('[data-scene-home]').click();
    await idle();
    await page.locator('[data-scene-light]').evaluate((input) => {
      input.value = '0.5';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await idle();
    await page.locator('[data-scene-shadows]').uncheck();
    await idle();
    await page.setViewportSize({ width: locale === 'en' ? 1000 : 420, height: 820 });
    await idle();
    const size = await page
      .locator('[data-scene-canvas]')
      .evaluate((canvas) => [
        canvas.width,
        canvas.height,
        canvas.clientWidth * devicePixelRatio,
        canvas.clientHeight * devicePixelRatio,
      ]);
    assert.deepEqual(size.slice(0, 2), size.slice(2));
    assert.equal(await page.locator('[data-scene-status]').textContent(), '');
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.screenshot({
      path: resolve(out, `garden-${locale}.png`),
      fullPage: true,
      animations: 'disabled',
    });
    await page.evaluate((language) => {
      location.hash = `#/${language}/learn/home`;
    }, locale);
    await page.locator('[data-scene-canvas]').waitFor({ state: 'detached' });
    await page.waitForTimeout(400);
    const frames = await page.evaluate(() => window.startupFrames);
    await page.waitForTimeout(400);
    assert.equal(
      await page.evaluate(() => window.startupFrames),
      frames,
      'unmount stops all scene frames',
    );
  }
}
