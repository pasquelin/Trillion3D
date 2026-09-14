import test from 'node:test';
import assert from 'node:assert/strict';
import { createTerminalProgress, createBatchProgress } from './progress.mts';
function capture() {
  const chunks = [];
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
  assert.match(lines.at(-1), /^✔ 1\/1 city 1,234 triangles, 3 primitives, 42 ms/);
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
  assert.match(out.text().trim().split('\n').at(-1), /99%/);
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
