// System Chrome, launched in a uniform way for the benchmark, oracle, and rendering proofs.
//
// Playwright locates it via channel (`channel: 'chrome'`) on Windows, macOS, or Linux:
// no path is hardcoded here, and a machine without Chrome installed receives Playwright's error,
// which names what is missing. The system Chrome is launched, never Playwright's Chromium:
// measurements and proofs run on the browser used by end users.
import { realpathSync, writeSync } from 'node:fs';
import { relative, sep } from 'node:path';
import { chromium } from 'playwright';
import type { LaunchOptions } from 'playwright';
import { isUnitTest } from '../../scripts/unit-tests.ts';
import { BROWSER, listBrowserFiles, listJustesseTests } from '../../tests/browser/test-gpu.ts';
import { RACINE } from '../core/paths.ts';

/** How every refusal starts, for the tests that count them. */
export const CHROME_REFUSED = 'Chrome refused';

/** The entry file, resolved; `null` with none: `node -e`, `--eval`, `--print`, stdin, the REPL. */
function entryFile(entry: string | undefined) {
  if (!entry || process.execArgv.some((flag) => /^(-e|-p|--eval|--print)(=|$)/.test(flag)))
    return null;
  try {
    return realpathSync(entry);
  } catch {
    return null;
  }
}

/** Whether the process runs under `node --test`: a runner's child (`NODE_TEST_CONTEXT`) or the
 *  runner itself (`--test`, with `--test-isolation=none`). */
const underNodeTest = () =>
  process.env.NODE_TEST_CONTEXT !== undefined || process.execArgv.includes('--test');

/** A proof `test:gpu` runs (`tests/browser/test-gpu.ts` lists them, a declared exclusion
 *  included, so it can still be run on its own). */
function isGpuProof(path: string) {
  const proofs = [
    ...listJustesseTests(),
    ...listBrowserFiles().map((file) => `${BROWSER}/${file}`),
  ];
  return proofs.includes(path);
}

/**
 * Throws when Chrome would start from an import instead of a run (AGENTS.md rule 2): with no entry
 * file (`node -e`, the REPL), from a unit test entry, or under `node --test` from anything but a
 * `test:gpu` proof. Any other explicit script opens Chrome on purpose, wherever it lives: a
 * proof, the bench, a script, a measurer's harness in its scratch folder. `testRun` says whether
 * the process runs under `node --test`; the guard's own tests set it.
 */
export function assertBrowserEntryPoint(entry = process.argv[1], testRun = underNodeTest()) {
  const file = entryFile(entry);
  const path = file && relative(RACINE, file).split(sep).join('/');
  const refused = !path || isUnitTest(path) || (testRun && !isGpuProof(path));
  if (!refused) return;
  throw new Error(
    `${CHROME_REFUSED}: the entry point ${entry || '(none)'} is no explicit run, or is a unit ` +
      'test. Importing a proof never launches a browser; run it on its own ' +
      '(`pnpm run test:gpu <file>`).',
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

/** Set on the proof import test's children: loading this launcher where it would refuse ends the
 *  process there, failed. Modules run after their imports, so the proof's own work never starts. */
export const EXIT_ON_REFUSAL = 'TRILLION3D_EXIT_ON_CHROME_REFUSAL';

if (process.env[EXIT_ON_REFUSAL])
  try {
    assertBrowserEntryPoint();
  } catch (error) {
    writeSync(2, `${(error as Error).message}\n`);
    process.exit(1);
  }
