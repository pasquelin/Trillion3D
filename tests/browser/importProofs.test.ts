// Every file of the two proof folders, imported by Node, opens no browser (AGENTS.md rule 2): the
// one launcher refuses (`bench/runner/chrome.ts`). Each file is imported in a child process whose
// entry point is this test, so a proof's work, exit code and `test()` calls stay there; the
// child replaces Playwright's launch, so a broken guard fails here instead of opening Chrome.
// The child ends at the refusal, and writes its outputs and temporary files only in this run's
// scratch folder: a measurement running in the same checkout keeps every file it writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { MEASURE_OUT } from '../../bench/core/paths.ts';
import { EXIT_ON_REFUSAL } from '../../bench/runner/chrome.ts';
import { BROWSER, JUSTESSE, RACINE } from './test-gpu.ts';

const TARGET = 'TRILLION3D_IMPORT_PROOF',
  REPORT = 'import report: ',
  REFUSED = 'Chrome refused';
const FOLDERS = [JUSTESSE, BROWSER];
/** How long a child whose proof left a server open waits, once imported, for a late launch. */
const SETTLE_MS = 3000;
/** The most a child's import may take before it leaves: a proof stuck before its launch. */
const IMPORT_CAP_MS = 60_000;

/** Written at once: a pipe on macOS drops what is still queued when the child exits. */
const say = (text: string) => void writeSync(1, `${text}\n`);

/** The child: import one file, count what reached Playwright, report it on exit. */
async function importOne(file: string) {
  let reached = 0;
  chromium.launch = async () => {
    reached++;
    throw new Error('Playwright reached');
  };
  process.on('exit', () => say(REPORT + JSON.stringify({ reached })));
  const leaveAfter = (ms: number) => setTimeout(() => process.exit(0), ms).unref();
  leaveAfter(IMPORT_CAP_MS);
  // The settle wait starts once the import is done: a proof slow to reach its launch still meets
  // the launcher, instead of passing for having been cut short.
  await import(pathToFileURL(file).href).then(
    () => leaveAfter(SETTLE_MS),
    (error: Error) => {
      say(error.message);
      process.exit(0);
    },
  );
}

function importInChild(file: string, scratch: string) {
  // The child runs on its own, not as a test runner's child speaking its protocol on stdout.
  const { NODE_TEST_CONTEXT: _runner, ...inherited } = process.env;
  const env = {
    ...inherited,
    [TARGET]: file,
    [EXIT_ON_REFUSAL]: '1',
    [MEASURE_OUT]: join(scratch, 'out'),
    TMPDIR: scratch,
  };
  const args = ['--experimental-strip-types', fileURLToPath(import.meta.url)];
  return new Promise<string>((done) =>
    execFile(process.execPath, args, { env, maxBuffer: 1 << 26 }, (_error, out, err) =>
      done(out + err),
    ),
  );
}

async function importAll(files: string[], scratch: string) {
  const outputs = new Map<string, string>();
  const queue = [...files];
  const worker = async () => {
    for (let file = queue.shift(); file; file = queue.shift())
      outputs.set(file, await importInChild(file, scratch));
  };
  // A few children at a time: the test shares the machine with the other sessions' runs.
  const children = Math.min(4, Math.max(1, availableParallelism() >> 1));
  await Promise.all(Array.from({ length: children }, worker));
  return outputs;
}

if (process.env[TARGET]) await importOne(process.env[TARGET]);
else
  test('importing any probe or render proof starts no browser: the launcher refuses', async () => {
    const files = FOLDERS.flatMap((folder) =>
      readdirSync(join(RACINE, folder))
        .filter((name) => name.endsWith('.ts'))
        .map((name) => join(RACINE, folder, name)),
    );
    // A proof may prepare its outputs, or a temporary folder, before it asks for Chrome.
    const logs = join(RACINE, '.worktrees', 'logs');
    mkdirSync(logs, { recursive: true });
    const scratch = mkdtempSync(join(logs, 'import-proofs-'));
    try {
      const outputs = await importAll(files, scratch);
      for (const [file, output] of outputs) {
        const report = output.split('\n').find((line) => line.startsWith(REPORT));
        assert.ok(report, `${file}: the child did not report\n${output}`);
        assert.deepEqual(JSON.parse(report.slice(REPORT.length)), { reached: 0 }, file);
      }
      for (const folder of FOLDERS) {
        const refused = [...outputs].filter(([f, o]) => f.includes(folder) && o.includes(REFUSED));
        assert.ok(refused.length > 0, `no file of ${folder} reached the launcher`);
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
