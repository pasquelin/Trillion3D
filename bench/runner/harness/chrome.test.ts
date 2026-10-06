// The one Chrome launcher refuses a browser to an import: no entry file, a unit test, or anything
// under `node --test` but a Chrome proof — no test opens a browser. Any other explicit script opens
// it, wherever it lives. Playwright's launch is replaced here, so a broken guard fails this test
// instead of opening Chrome.
import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { assertBrowserEntryPoint, launchChrome } from './chrome.ts'
import { CHROME_SUFFIX, listProofFiles } from '../../dawn/proofs.ts'

const at = (path: string) => join(import.meta.dirname, '../../..', path)

test('under node --test, only a Chrome proof may open Chrome', () => {
  const proof = at(listProofFiles(CHROME_SUFFIX)[0])
  assert.doesNotThrow(() => assertBrowserEntryPoint(proof, true), proof)
  for (const entry of [
    '',
    fileURLToPath(import.meta.url),
    at('bench/runner/bench.ts'),
    at('tests/gpu/placement/shear-transform.gpu.ts'),
  ])
    assert.throws(() => assertBrowserEntryPoint(entry, true), /Chrome refused/, entry)
})

test('any explicit script but a unit test may open Chrome, wherever it lives', () => {
  const runs = [at('bench/runner/bench.ts'), at('scripts/site-first-load.ts')]
  for (const run of [...runs, process.execPath])
    assert.doesNotThrow(() => assertBrowserEntryPoint(run, false), run)
  for (const entry of ['', at('scripts/check-changed.test.ts'), at('absent-script.ts')])
    assert.throws(() => assertBrowserEntryPoint(entry, false), /Chrome refused/, entry)
})

test('launchChrome from a unit test is refused before Playwright is reached', async () => {
  const launch = mock.method(chromium, 'launch', async () => {
    throw new Error('Playwright reached')
  })
  try {
    await assert.rejects(launchChrome({ headless: true }), /Chrome refused/)
    assert.equal(launch.mock.callCount(), 0)
  } finally {
    launch.mock.restore()
  }
})

/** What a harness in a scratch folder prints: `launch` stands for Playwright's, `call` is its
 *  call of `launchChrome`. */
function scratchHarness(launch: string, call: string) {
  const logs = at('.worktrees/logs')
  mkdirSync(logs, { recursive: true })
  const scratch = mkdtempSync(join(logs, 'chrome-harness-'))
  const harness = join(scratch, 'harness.mts')
  writeFileSync(
    harness,
    `import { chromium } from '${import.meta.resolve('playwright')}';\n` +
      `import { launchChrome } from '${import.meta.resolve('./chrome.ts')}';\n` +
      `chromium.launch = ${launch};\n` +
      `console.log(await ${call});\n`,
  )
  try {
    const { NODE_TEST_CONTEXT: _runner, ...env } = process.env
    return execFileSync(process.execPath, [harness], { env, encoding: 'utf8' })
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

test('a harness run from a scratch folder reaches Playwright, stubbed: nothing starts', () => {
  assert.equal(scratchHarness("async () => 'stubbed'", 'launchChrome()'), 'stubbed\n')
})

// #1364: Playwright's headless shell loses every WebGPU device right after the first frame, so a
// harness asking for it, or for another browser path, still gets the system Chrome.
test('a channel or a browser path given to launchChrome never opens another browser', () => {
  const printed = scratchHarness(
    'async (options) => JSON.stringify([options.channel, options.executablePath ?? null])',
    "launchChrome({ headless: true, channel: 'chromium', executablePath: '/shell' })",
  )
  assert.equal(printed, '["chrome",null]\n')
})
