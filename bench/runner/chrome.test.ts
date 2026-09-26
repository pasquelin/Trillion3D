// The one Chrome launcher refuses a browser to any process whose entry point is no proof, bench or
// script run (AGENTS.md rule 2). Playwright's launch is replaced here, so a broken guard fails
// this test instead of opening Chrome.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { RACINE, listBrowserTests, listJustesseTests } from '../../tests/browser/test-gpu.ts';
import { assertBrowserEntryPoint, launchChrome } from './chrome.ts';

const at = (path: string) => join(RACINE, path);

test('a proof, a bench runner or a script run as the entry point may open Chrome', () => {
  const runs = [
    listJustesseTests()[0],
    listBrowserTests()[0],
    'bench/runner/bench.ts',
    'scripts/site-first-load.ts',
  ];
  for (const run of runs) assert.doesNotThrow(() => assertBrowserEntryPoint(at(run)), run);
});

test('a unit test, a support module, a missing file or no file at all may not', () => {
  const refused = [
    '',
    fileURLToPath(import.meta.url),
    at('scripts/check-changed.test.ts'),
    at('tests/browser/probes/pageWebgpu.ts'),
    at('tests/browser/probes/absent-probe.ts'),
    dirname(RACINE),
  ];
  for (const entry of refused)
    assert.throws(() => assertBrowserEntryPoint(entry), /Chrome refused/, entry);
});

test('launchChrome from a unit test is refused before Playwright is reached', async () => {
  const launch = mock.method(chromium, 'launch', async () => {
    throw new Error('Playwright reached');
  });
  try {
    await assert.rejects(launchChrome({ headless: true }), /Chrome refused/);
    assert.equal(launch.mock.callCount(), 0);
  } finally {
    launch.mock.restore();
  }
});
