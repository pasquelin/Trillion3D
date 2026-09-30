import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { manifest } from '../../../../tests/fixtures/manifestBinary.ts';
import { writePagedManifest } from '../../../../tests/fixtures/pagedManifest.ts';

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** What the CLI prints on stdout for a ready compilation, as far as this test reads it. */
interface CliSummary {
  status: string;
  key: string;
  selectedTriangles: number;
  primitives?: unknown;
}

const run = (args: string[], env: NodeJS.ProcessEnv = {}): Promise<RunResult> =>
  new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ['--experimental-strip-types', 'packages/sdk-node/src/cli/cli.mts', ...args],
      {
        cwd: new URL('../../../..', import.meta.url),
        env: { ...process.env, ...env },
      },
    );
    let stdout = '',
      stderr = '';
    child.stdout.on('data', (value: Buffer) => (stdout += value.toString()));
    child.stderr.on('data', (value: Buffer) => (stderr += value.toString()));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
test('CLI emits only its summary on stdout and events on stderr', async () => {
  const root = await mkdtemp(join(tmpdir(), 'trillion3d-cli-'));
  try {
    const cache = join(root, 'cache');
    const slice = { ...manifest(), key: 'abc', scope: 'slice' as const, selectedTriangles: 3 };
    await writePagedManifest(join(cache, 'native', 'slice', 'abc'), slice);
    const executable = join(root, 'compiler');
    await writeFile(
      executable,
      `#!/bin/sh\necho '{"event":"progress","job":"job","phase":"work"}' >&2\necho '{"status":"ready","key":"abc","scope":"slice","url":"abc/clusters.json","pointer":"${cache}/native/slice/manifest.json","cache":"${cache}"}'\n`,
    );
    await chmod(executable, 0o755);
    const result = await run(['source', cache, 'slice', '12', '/assets/'], {
      TRILLION3D_COMPILER_BIN: executable,
    });
    assert.equal(result.code, 0);
    const output = JSON.parse(result.stdout) as CliSummary;
    assert.equal(output.status, 'ready');
    assert.equal(output.key, 'abc');
    assert.equal(output.selectedTriangles, 3);
    assert.equal(output.primitives, undefined);
    assert.deepEqual(JSON.parse(result.stderr), { event: 'progress', job: 'job', phase: 'work' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('CLI rejects an invalid triangle budget before invoking a compiler', async () => {
  const result = await run(['source', 'cache', 'slice', 'nope', '/assets/']);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /positive integer/);
  assert.equal(result.stdout, '');
});
// Behaviour: a DAG warning does not stop a compile that succeeds — exit 0, the warning told once as
// a JSON event on a pipe — and `--strict` turns it into its own exit code, the cache still written.
test('a DAG warning exits 0 by default and 3 with --strict', async () => {
  const root = await mkdtemp(join(tmpdir(), 'trillion3d-cli-strict-'));
  try {
    const cache = join(root, 'cache');
    const slice = { ...manifest(), key: 'abc', scope: 'slice' as const, selectedTriangles: 3 };
    await writePagedManifest(join(cache, 'native', 'slice', 'abc'), slice);
    const executable = join(root, 'compiler');
    const warned = JSON.stringify({
      event: 'progress',
      job: 'job',
      phase: 'primitive',
      mesh: 0,
      primitive: 0,
      warnings: [{ code: 'DAG_FLAT', roots: 9, pages: 9, groups: {} }],
    });
    await writeFile(
      executable,
      `#!/bin/sh\necho '${warned}' >&2\necho '{"status":"ready","key":"abc","scope":"slice","url":"abc/clusters.json","pointer":"${cache}/native/slice/manifest.json","cache":"${cache}"}'\n`,
    );
    await chmod(executable, 0o755);
    const args = ['source', cache, 'slice', '12', '/assets/'];
    const env = { TRILLION3D_COMPILER_BIN: executable };
    const lenient = await run(args, env);
    assert.equal(lenient.code, 0, lenient.stderr);
    const told = lenient.stderr
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((event) => event.event === 'message');
    assert.deepEqual(
      told.map(({ code, level, count }) => ({ code, level, count })),
      [{ code: 'DAG_FLAT', level: 'warn', count: 1 }],
    );
    assert.match(String(told[0].id), /^T3D-W\d{3}$/);
    const strict = await run(['--strict', ...args], env);
    assert.equal(strict.code, 3, strict.stderr);
    assert.match(strict.stderr, /"code":"STRICT_WARNINGS"/);
    assert.equal((JSON.parse(strict.stdout) as CliSummary).status, 'ready');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
