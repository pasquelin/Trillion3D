import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareMany } from '../index.mts';
import type {
  BatchJob,
  BatchOutcome,
  BatchSummary,
  CompilationPointer,
  CompilerEvent,
} from '../compiler/contracts.ts';

/** A batch summary as the compiler prints it: one line on stdout, the outcome of every job. */
const summaryOf = (status: BatchSummary['status'], jobs: BatchOutcome[]): BatchSummary => ({
  status,
  completed: jobs.filter((job) => job.status === 'ready').length,
  failed: jobs.filter((job) => job.status === 'error').length,
  cancelled: 0,
  jobs,
});
/** What the native compiler prints when it refuses a batch outright, never one job's outcome. */
interface BatchRefusal {
  status: 'error';
  code: string;
  message: string;
}
/**
 * A stand-in for the native compiler that speaks its real exit protocol: events on stderr, the
 * summary on stdout, and the exit code the batch mode uses — 2 as soon as one job did not succeed.
 */
async function compilerPrinting(
  root: string,
  summary: BatchSummary | BatchRefusal,
  code: number,
): Promise<string> {
  const executable = join(root, 'compiler');
  await writeFile(
    executable,
    `#!/bin/sh\necho '{"event":"batch","job":"*","jobs":2,"workers":1}' >&2\necho '${JSON.stringify(summary)}'\nexit ${code}\n`,
  );
  await chmod(executable, 0o755);
  return executable;
}
const job = (id: string): BatchJob => ({
  id,
  source: `${id}.obj`,
  cache: `cache/${id}`,
  resourceBaseUrl: `/${id}/`,
});

test('A16 prepareMany returns the summary of a partially successful batch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'web-geometry-batch-test-'));
  try {
    const summary = summaryOf('partial', [
      {
        job: 'a',
        status: 'ready',
        pointer: { status: 'ready', key: 'abc', scope: 'full' } as CompilationPointer,
      },
      { job: 'b', status: 'error', code: 'IMPORT_IO_ERROR', message: 'no such file' },
    ]);
    const executable = await compilerPrinting(root, summary, 2);
    const events: CompilerEvent[] = [];
    const result = await prepareMany([job('a'), job('b')], {
      executable,
      onEvent: (event) => events.push(event),
    });
    assert.equal(result.status, 'partial');
    assert.equal(result.completed, 1);
    assert.equal(result.failed, 1);
    assert.deepEqual(
      result.jobs.map((outcome) => outcome.job),
      ['a', 'b'],
    );
    assert.equal(result.jobs[1].code, 'IMPORT_IO_ERROR');
    assert.equal(events[0].event, 'batch');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('A16 prepareMany returns the summary of a wholly failed batch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'web-geometry-batch-test-'));
  try {
    const summary = summaryOf('failed', [
      { job: 'a', status: 'error', code: 'IMPORT_IO_ERROR', message: 'no such file' },
    ]);
    const executable = await compilerPrinting(root, summary, 2);
    const result = await prepareMany([job('a')], { executable });
    assert.equal(result.status, 'failed');
    assert.equal(result.jobs[0].code, 'IMPORT_IO_ERROR');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('A16 prepareMany still rejects a batch the compiler refused outright', async () => {
  const root = await mkdtemp(join(tmpdir(), 'web-geometry-batch-test-'));
  try {
    const executable = await compilerPrinting(
      root,
      { status: 'error', code: 'INVALID_BATCH', message: 'jobs must not be empty' },
      2,
    );
    await assert.rejects(prepareMany([job('a')], { executable }), /INVALID_BATCH/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
