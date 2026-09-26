// System Chrome, launched in a uniform way for the benchmark, oracle, and rendering proofs.
//
// Playwright locates it via channel (`channel: 'chrome'`) on Windows, macOS, or Linux:
// no path is hardcoded here, and a machine without Chrome installed receives Playwright's error,
// which names what is missing. The system Chrome is launched, never Playwright's Chromium:
// measurements and proofs run on the browser used by end users.
import { realpathSync } from 'node:fs';
import { relative, sep } from 'node:path';
import { chromium } from 'playwright';
import type { LaunchOptions } from 'playwright';
import { isUnitTest } from '../../scripts/unit-tests.ts';
import { RACINE, listBrowserTests, listJustesseTests } from '../../tests/browser/test-gpu.ts';

/** Folders whose entry points open Chrome on purpose: the bench and the repository's scripts. */
const LAUNCHING_FOLDERS = ['bench/', 'scripts/'];

const repositoryPath = (entry: string) => {
  try {
    return relative(RACINE, realpathSync(entry)).split(sep).join('/');
  } catch {
    return null;
  }
};

/**
 * Throws unless the process's entry point is a run that opens Chrome on purpose: a proof
 * `test:gpu` runs (`tests/browser/test-gpu.ts` lists them), or a bench or script entry that is no
 * unit test. A Node import — by a unit test, `node -e` or a review agent's scratch file — never
 * starts a browser (AGENTS.md rule 2).
 */
export function assertBrowserEntryPoint(entry = process.argv[1]) {
  const path = entry ? repositoryPath(entry) : null;
  if (path && [...listJustesseTests(), ...listBrowserTests()].includes(path)) return;
  if (path && LAUNCHING_FOLDERS.some((folder) => path.startsWith(folder)) && !isUnitTest(path))
    return;
  throw new Error(
    `Chrome refused: the entry point ${entry || '(none)'} is no proof, bench or script run. ` +
      'Importing a proof never launches a browser; run it on its own (`pnpm run test:gpu <file>`).',
  );
}

/**
 * Launches system Chrome. `options` are those of `chromium.launch` — `headless`, `args` —,
 * with the channel set here and nowhere else. Refused unless a proof, bench or script run is the
 * entry point (`assertBrowserEntryPoint`).
 */
export async function launchChrome(options: LaunchOptions = {}) {
  assertBrowserEntryPoint();
  return chromium.launch({ channel: 'chrome', ...options });
}
