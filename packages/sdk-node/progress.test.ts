import test from 'node:test';
import assert from 'node:assert/strict';
import { createTerminalProgress, createBatchProgress } from './progress.mts';
import type { DagWarning } from '../sdk-core/index.ts';
import type { ProgressStream } from './contracts.ts';

function capture(): { stream: ProgressStream; text: () => string } {
  const chunks: string[] = [];
  return {
    stream: { isTTY: false, columns: 80, write: (c) => chunks.push(c) },
    text: () => chunks.join(''),
  };
}
test('a non-TTY stream gets one line per phase and a final summary built from the pointer', () => {
  const out = capture();
  const progress = createTerminalProgress({ label: 'city', stream: out.stream });
  progress.event({ event: 'accepted', job: 'job', ratio: 0 });
  progress.event({ event: 'progress', job: 'job', phase: 'import', ratio: 0.35, primitives: 3 });
  for (let i = 0; i < 3; i++)
    progress.event({
      event: 'progress',
      job: 'job',
      phase: 'primitive',
      ratio: 0.35 + 0.2 * (i + 1),
    });
  progress.event({
    event: 'complete',
    job: 'job',
    ratio: 1,
    pointer: { selectedTriangles: 1234, primitives: 3, metrics: { wallMs: 42 } },
  });
  const lines = out.text().trim().split('\n');
  assert.match(lines[0], /1\/1 city \[░+\]\s+0% starting/);
  assert.match(lines[1], /35% source geometry written/);
  assert.equal(
    lines.filter((l) => l.includes('clustering')).length,
    1,
    'plain mode prints the clustering phase once',
  );
  assert.match(lines[lines.length - 1], /^✔ 1\/1 city 1,234 triangles, 3 primitives, 42 ms/);
});
test('a reused folder prints what was proven, a refused one prints why', () => {
  const out = capture();
  const progress = createTerminalProgress({ label: 'city', stream: out.stream });
  progress.event({
    event: 'progress',
    job: 'job',
    phase: 'reuse',
    ratio: 0.98,
    completed: 1,
    total: 1,
    objects: 12,
    objectBytes: 3 * 1048576,
  });
  progress.event({
    event: 'progress',
    job: 'job',
    phase: 'reuse',
    ratio: 0.98,
    completed: 0,
    total: 1,
    reason: 'sidecar does not match binary.sha256',
  });
  const lines = out.text().trim().split('\n');
  assert.match(lines[0], /98% reused 12 objects \(3 MB proven\)/);
  assert.match(lines[1], /rebuilding: sidecar does not match binary\.sha256/);
});
test('errors and cancellations close the line with a cross and the code', () => {
  const out = capture();
  const progress = createTerminalProgress({ label: 'x', stream: out.stream });
  progress.event({
    event: 'error',
    status: 'error',
    job: 'job',
    code: 'EMPTY_SLICE',
    message: 'nothing fits',
  });
  assert.match(out.text(), /✖ 1\/1 x EMPTY_SLICE nothing fits/);
});
test('the ratio never goes backwards and is clamped to one', () => {
  const out = capture();
  const progress = createTerminalProgress({ label: 'x', stream: out.stream });
  progress.event({
    event: 'progress',
    job: 'job',
    phase: 'bootstrap',
    completed: 1,
    total: 1,
    ratio: 0.99,
  });
  progress.event({ event: 'progress', job: 'job', phase: 'primitive', ratio: 0.4 });
  const closingLines = out.text().trim().split('\n');
  assert.match(closingLines[closingLines.length - 1], /99%/);
});
test('batch progress opens one line per job id and ignores batch-level lines', () => {
  const out = capture();
  const batch = createBatchProgress({ stream: out.stream });
  batch.event({ event: 'batch', job: '*', jobs: 2, workers: 2 });
  batch.event({ event: 'queued', job: 'a' });
  batch.event({ event: 'queued', job: 'b' });
  batch.event({ event: 'complete', job: 'a', pointer: { selectedTriangles: 1 } });
  batch.event({ event: 'done', job: '*' });
  const text = out.text();
  assert.match(text, /1\/2 a/);
  assert.match(text, /2\/2 b/);
  assert.match(text, /✔ 1\/2 a 1 triangles/);
});
// Behaviour: DAG warnings carried by primitive events are counted and stated in one line at the
// end of the job — per code, with the worst case — never one line per primitive.
test('DAG warnings are summarised in one line when the job completes', () => {
  const out = capture();
  const progress = createTerminalProgress({ label: 'village', stream: out.stream });
  const warn = (mesh: number, warnings: DagWarning[]) =>
    progress.event({
      event: 'progress',
      job: 'job',
      phase: 'primitive',
      ratio: 0.5,
      mesh,
      primitive: 0,
      warnings,
    });
  warn(7, [{ code: 'DAG_FLAT', roots: 98, pages: 98, groups: { noCollapse: 4 } }]);
  warn(9, [{ code: 'DAG_ROOTS', roots: 6, pages: 27, groups: { noCollapse: 1 } }]);
  assert.doesNotMatch(out.text(), /⚠/, 'nothing is said before the end');
  progress.event({ event: 'complete', job: 'job', ratio: 1, pointer: { primitives: 2 } });
  assert.match(
    out.text(),
    /⚠ village: 2 primitive\(s\) without a unique root \(1 DAG_FLAT, 1 DAG_ROOTS\) ; worst mesh 7\/0: 98 roots out of 98 pages — detail in clusters.json\n✔ 1\/1 village/,
  );
});
