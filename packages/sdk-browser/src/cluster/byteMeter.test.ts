import test from 'node:test';
import assert from 'node:assert/strict';
import { byteMeter } from './byteMeter.ts';

/** A body sent in `chunks`, with the headers a server gives it. */
const answer = (chunks: number[], headers: Record<string, string> = {}) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const size of chunks) controller.enqueue(new Uint8Array(size));
        controller.close();
      },
    }),
    { headers },
  );

test('the meter counts every chunk against the declared lengths and ends on loaded === total', async () => {
  const heard: [number, number][] = [];
  const meter = byteMeter((loaded, total) => heard.push([loaded, total]));
  const first = meter(answer([3, 4], { 'content-length': '7' }));
  const second = meter(answer([5], { 'content-length': '5' }));
  assert.deepEqual(heard, [
    [0, 7],
    [0, 12],
  ]);
  assert.equal((await first.arrayBuffer()).byteLength, 7, 'the body reads whole through it');
  await second.arrayBuffer();
  assert.deepEqual(heard.at(-1), [12, 12]);
  assert.ok(heard.every(([loaded, total]) => loaded <= total));
});

test('a body with no length, or an encoded one, corrects the total to what it held', async () => {
  const heard: [number, number][] = [];
  const meter = byteMeter((loaded, total) => heard.push([loaded, total]));
  await meter(answer([2, 2])).arrayBuffer();
  await meter(answer([6], { 'content-length': '3', 'content-encoding': 'gzip' })).blob();
  await meter(answer([1], { 'content-length': '9' })).arrayBuffer();
  assert.deepEqual(heard.at(-1), [11, 11]);
  assert.ok(heard.every(([loaded, total]) => loaded <= total));
});
