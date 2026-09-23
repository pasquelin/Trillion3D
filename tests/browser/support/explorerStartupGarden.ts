import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import type { Page } from 'playwright';
import { DIAGNOSTIC_MODES } from '../../../site/lessons/engine-scene/diagnosticModes.ts';

// Counters an init script installs on the page's own `window`, read back through `evaluate`.
declare global {
  interface Window {
    startupFrames: number;
    startupQuiet: { frames: number; since: number } | null;
  }
}

/** Exercise the actual portal lifecycle; counters observe engine frames without drawing. */
export async function startupGarden(page: Page, base: string, out: string) {
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
    await page.goto(`${base}/site/index.html#/${locale}/lessons/engine-scene`);
    const mode = page.locator('[data-scene-mode]');
    await page
      .waitForFunction(
        () => {
          const control = document.querySelector('[data-scene-mode]') as HTMLSelectElement | null;
          return control && !control.disabled;
        },
        undefined,
        { timeout: 60000 },
      )
      .catch(async (error: unknown) => {
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
    const number = async (name: string) =>
      Number(((await page.locator(`[data-scene-${name}]`).textContent()) ?? '').replace(/\D/g, ''));
    // The cut follows the canvas: the desktop width pins its count, the phone width its own.
    const selected = await number('selected');
    if (locale === 'en') assert.equal(selected, 35840);
    else assert.ok(selected > 0, 'the phone width selects triangles');
    assert.equal(await number('drawn'), selected, 'every selected triangle is drawn');
    const code = (await page.locator('[data-code-block] pre code').allTextContents()).join('\n');
    assert.match(code, /createWorld\('garden'\)/);
    assert.match(code, /world\.scene\.load\(/);
    assert.doesNotMatch(code, /querySelector|requestAnimationFrame|ResizeObserver/);
    // The lesson's own list, beauty last: a hand copy drifted from it once (#281).
    for (const view of [...DIAGNOSTIC_MODES.slice(1), DIAGNOSTIC_MODES[0]]) {
      if (await mode.locator(`option[value="${view}"]`).isDisabled()) continue;
      await mode.selectOption(view);
      await idle();
    }
    await page.locator('[data-scene-zoom-in]').click();
    await idle();
    await page.locator('[data-scene-home]').click();
    await idle();
    await page.locator('[data-scene-light]').evaluate((input: HTMLInputElement) => {
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
      .evaluate((canvas: HTMLCanvasElement) => [
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
    await page.evaluate((language: string) => {
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
