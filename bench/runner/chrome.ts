// System Chrome, launched in a uniform way for the benchmark, the oracles and the recette's proofs.
//
// Playwright locates it via channel (`channel: 'chrome'`) on Windows, macOS, or Linux:
// no path is hardcoded here, and a machine without Chrome installed receives Playwright's error,
// which names what is missing. The system Chrome is launched, never Playwright's Chromium:
// measurements and proofs run on the browser used by end users.
import { chromium } from 'playwright';
import type { Browser, LaunchOptions, Page } from 'playwright';
import { isUnitTest } from '../../scripts/unit-tests.ts';
import { entryPath, underNodeTest } from '../core/entryPoint.ts';
import { CHROME_SUFFIX, isProof } from '../dawn/proofs.ts';

/** How every refusal starts, for the tests that count them. */
export const CHROME_REFUSED = 'Chrome refused';

/**
 * Throws when Chrome would start from an import instead of a run: with no entry file (`node -e`,
 * the REPL), from a unit test entry, or under `node --test` from anything but a Chrome proof — no
 * test opens a browser, the GPU proofs run on Dawn, and the recette alone runs the Chrome ones
 * (`bench/dawn/proofs.ts --chrome`). Any other explicit script opens Chrome on purpose, wherever it
 * lives: the bench, a script, a measurer's harness in its scratch folder. `testRun` says whether
 * the process runs under `node --test`; the guard's own tests set it.
 */
export function assertBrowserEntryPoint(entry = process.argv[1], testRun = underNodeTest()) {
  const path = entryPath(entry);
  if (path && !isUnitTest(path) && (!testRun || isProof(path, CHROME_SUFFIX))) return;
  throw new Error(
    `${CHROME_REFUSED}: the entry point ${entry || '(none)'} is no explicit run, is a unit test ` +
      'or runs under node --test and is no Chrome proof: no test opens a browser.',
  );
}

/**
 * Launches system Chrome. `options` are those of `chromium.launch` — `headless`, `args` —,
 * with the channel set here and nowhere else: a channel or a browser path given is overridden.
 * Playwright's own headless shell, which `chromium.launch` opens without a channel, composites a
 * WebGPU canvas it cannot read: the device is lost right after the first frame (#1364), every
 * example with it. Refused unless a bench, script or Chrome proof run is the entry point
 * (`assertBrowserEntryPoint`).
 */
export async function launchChrome(options: LaunchOptions = {}) {
  assertBrowserEntryPoint();
  return chromium.launch({ ...options, channel: 'chrome', executablePath: undefined });
}

/**
 * `run` on the one page of a fresh Chrome (`launch`), sized `view` and loaded from `url`; the page
 * and the browser are closed after it. A large scene leaves several hundred MB in Chromium's GPU
 * process that closing the page does not release: a fresh browser per run frees it. `watch` hears
 * the page and its browser before the page loads.
 */
export async function onFreshPage<T>(
  launch: LaunchOptions,
  view: { url: string; width: number; height: number; dpr: number },
  run: (page: Page) => Promise<T>,
  watch?: (page: Page, browser: Browser) => void,
): Promise<T> {
  const browser = await launchChrome(launch);
  try {
    const page = await browser.newPage({
      viewport: { width: view.width, height: view.height },
      deviceScaleFactor: view.dpr,
    });
    watch?.(page, browser);
    await page.goto(view.url, { waitUntil: 'load' });
    return await run(page);
  } finally {
    await browser.close();
  }
}
