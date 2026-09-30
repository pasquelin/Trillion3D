import test from 'node:test';
import assert from 'node:assert/strict';
import { createTerminalProgress, createBatchProgress } from './progress.mts';
import type { DagWarning } from '../../../sdk-core/src/index.ts';
import type { ProgressStream } from '../compiler/contracts.ts';

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
  assert.match(
    out.text(),
    /✖ 1\/1 x T3D-E\d{3} EMPTY_SLICE: .*\(nothing fits\) Raise the triangle budget/,
  );
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
/** A primitive's DAG warning, its stall a locked seam. */
const warning = (code: DagWarning['code'], roots: number, pages: number): DagWarning => ({
  code,
  roots,
  pages,
  groups: { seamLocked: 1 },
  rootTriangles: 640,
  ...{ cause: 'seam-locked', seamVertices: 30, lockedVertices: 4, uvIslands: 9 },
});
// Behaviour: warnings are counted while the job compiles and told once at its end — one line per
// code, with its public code, count, worst case and documentation page — never one line per
// primitive; an info code stays silent unless asked for.
test('many flagged primitives are summarised in one line per code when the job completes', () => {
  const out = capture();
  const progress = createTerminalProgress({ label: 'village', stream: out.stream });
  const primitive = (mesh: number, warnings: DagWarning[]) =>
    progress.event({
      event: 'progress',
      job: 'job',
      phase: 'primitive',
      mesh,
      primitive: 0,
      warnings,
    });
  progress.event({
    event: 'progress',
    job: 'job',
    phase: 'import',
    unsupported: { 'texture-missing': 3, 'node-hidden': 5 },
  });
  for (let mesh = 0; mesh < 40; mesh++)
    primitive(mesh, [warning('DAG_FLAT', mesh === 7 ? 98 : 9, 98)]);
  for (let mesh = 40; mesh < 43; mesh++) primitive(mesh, [warning('DAG_ROOTS', 6, 27)]);
  assert.doesNotMatch(out.text(), /⚠/, 'nothing is said before the end');
  progress.event({ event: 'complete', job: 'job', ratio: 1, pointer: { primitives: 43 } });
  const told = out
    .text()
    .split('\n')
    .filter((line) => line.startsWith('⚠'));
  assert.equal(told.length, 3, told.join('\n'));
  assert.match(
    told[0],
    /^⚠ village T3D-W\d{3} DAG_FLAT ×40: .* Worst: mesh 7\/0, 98 roots of 98 pages\. .*T3D-W\d{3}\.md$/,
  );
  assert.match(told[1], /^⚠ village T3D-W\d{3} DAG_ROOTS ×3: /);
  assert.match(told[2], /^⚠ village T3D-W\d{3} texture-missing ×3: /);
  assert.doesNotMatch(out.text(), /node-hidden/);
  assert.match(out.text(), /\n✔ 1\/1 village/);
});
// Behaviour: `verbose` tells each code once, then every occurrence under it, info codes included —
// the head of a code is never printed twice.
test('verbose adds the info codes and every occurrence under a single line per code', () => {
  const out = capture();
  const progress = createTerminalProgress({ label: 'yard', stream: out.stream, verbose: true });
  progress.event({
    event: 'progress',
    job: 'job',
    phase: 'import',
    unsupported: { 'texture-missing': 2, 'node-hidden': 1 },
  });
  for (const mesh of [3, 4])
    progress.event({
      event: 'progress',
      job: 'job',
      phase: 'primitive',
      mesh,
      primitive: 0,
      warnings: [warning('DAG_FLAT', mesh, 9)],
    });
  progress.event({ event: 'complete', job: 'job', ratio: 1, pointer: { primitives: 2 } });
  const text = out.text();
  assert.equal(text.match(/ DAG_FLAT ×/g)?.length, 1, text);
  assert.match(
    text,
    /\n {4}DAG_FLAT mesh 3\/0: 3 roots of 9 pages \(cause seam-locked\)\n {4}DAG_FLAT mesh 4\/0: /,
  );
  assert.match(text, /ℹ yard T3D-I\d{3} node-hidden ×1: /);
});
