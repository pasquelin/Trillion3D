// The one Chrome launcher refuses a browser to an import: no entry file, a unit test, or anything
// but a `test:gpu` proof under `node --test` (AGENTS.md rule 2). Any other explicit script opens
// it, wherever it lives. Playwright's launch is replaced here, so a broken guard fails this test
// instead of opening Chrome.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { RACINE, listBrowserTests, listJustesseTests } from '../../tests/browser/test-gpu.ts';
import { assertBrowserEntryPoint, launchChrome } from './chrome.ts';

const at = (path: string) => join(RACINE, path);
const proofs = [listJustesseTests()[0], listBrowserTests()[0]].map(at);

test('under node --test, only a test:gpu proof may open Chrome', () => {
  for (const proof of proofs) assert.doesNotThrow(() => assertBrowserEntryPoint(proof, true));
  const refused = [
    '',
    fileURLToPath(import.meta.url),
    at('tests/browser/probes/pageWebgpu.ts'),
    at('bench/runner/bench.ts'),
    at('tests/browser/probes/absent-probe.ts'),
  ];
  for (const entry of refused)
    assert.throws(() => assertBrowserEntryPoint(entry, true), /Chrome refused/, entry);
});

test('any explicit script but a unit test may open Chrome, wherever it lives', () => {
  const runs = [...proofs, at('bench/runner/bench.ts'), at('scripts/site-first-load.ts')];
  for (const run of [...runs, process.execPath])
    assert.doesNotThrow(() => assertBrowserEntryPoint(run, false), run);
  for (const entry of ['', at('scripts/check-changed.test.ts'), at('absent-script.ts')])
    assert.throws(() => assertBrowserEntryPoint(entry, false), /Chrome refused/, entry);
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

test('a harness run from a scratch folder reaches Playwright, stubbed: nothing starts', () => {
  const logs = at('.worktrees/logs');
  mkdirSync(logs, { recursive: true });
  const scratch = mkdtempSync(join(logs, 'chrome-harness-'));
  const harness = join(scratch, 'harness.mts');
  writeFileSync(
    harness,
    `import { chromium } from '${import.meta.resolve('playwright')}';\n` +
      `import { launchChrome } from '${import.meta.resolve('./chrome.ts')}';\n` +
      "chromium.launch = async () => 'stubbed';\n" +
      'console.log(await launchChrome());\n',
  );
  try {
    const { NODE_TEST_CONTEXT: _runner, ...env } = process.env;
    assert.equal(execFileSync(process.execPath, [harness], { env, encoding: 'utf8' }), 'stubbed\n');
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
