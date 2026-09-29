// Import every probe and support module without running proof work or reaching Playwright.
// The child has no launcher-refusal escape hatch: every import must resolve normally.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { chromium } from 'playwright';
import { MEASURE_OUT } from '../../bench/core/paths.ts';

const CHILD = 'TRILLION3D_IMPORT_PROBES';
const folder = join(import.meta.dirname, 'probes');
const files = readdirSync(folder)
  .filter((file) => file.endsWith('.ts'))
  .sort();

if (process.env[CHILD]) {
  let launches = 0;
  chromium.launch = async () => {
    launches++;
    throw new Error('Import reached Playwright');
  };
  for (const file of files) await import(pathToFileURL(join(folder, file)).href);
  // A premature exit, rejected import, extra output or lingering server cannot pass this report.
  console.log(JSON.stringify({ imported: files, launches }));
} else {
  test('every probe imports without executing its body or starting a browser', async () => {
    const logs = join(import.meta.dirname, '../../.worktrees/logs');
    mkdirSync(logs, { recursive: true });
    const scratch = mkdtempSync(join(logs, 'import-probes-'));
    const { TRILLION3D_EXIT_ON_CHROME_REFUSAL: _escape, ...env } = process.env;
    try {
      const output = await new Promise<string>((resolve, reject) => {
        execFile(
          process.execPath,
          ['--experimental-strip-types', fileURLToPath(import.meta.url)],
          {
            env: { ...env, [CHILD]: '1', [MEASURE_OUT]: scratch, TMPDIR: scratch },
            timeout: 20_000,
          },
          (error, stdout, stderr) => {
            if (error) reject(new Error(`${error.message}\n${stdout}\n${stderr}`));
            else if (stderr) reject(new Error(stderr));
            else resolve(stdout);
          },
        );
      });
      assert.equal(output, `${JSON.stringify({ imported: files, launches: 0 })}\n`);
      assert.deepEqual(readdirSync(scratch), [], 'imports must not write proof outputs');
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
}
