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

/** A meter and the shares it reported, `loaded / total`. */
function listened() {
  const heard: [number, number][] = [];
  const meter = byteMeter((loaded, total) => heard.push([loaded, total]));
  const shares = () => heard.map(([loaded, total]) => loaded / total);
  const rising = () => shares().every((share, at, all) => at === 0 || share >= all[at - 1]!);
  return { heard, meter, shares, rising };
}

test('no length and a gzip body count against the plan: the share rises, full only at the end', async () => {
  const { heard, meter, shares, rising } = listened();
  await meter.read(answer([5]), 'http://cache/clusters.json').arrayBuffer();
  assert.deepEqual(heard, [], 'nothing is heard before the plan');
  meter.plan(
    new Map([
      ['http://cache/a.bin', 4],
      ['http://cache/b.json', 6],
      ['http://cache/c.bin', 10],
    ]),
  );
  assert.deepEqual(heard, [[5, 25]], 'the plan sets the whole total at once');
  await meter.read(answer([2, 2]), 'http://cache/a.bin').arrayBuffer();
  const gzip = { 'content-length': '3', 'content-encoding': 'gzip' };
  await meter.read(answer([3, 3], gzip), 'http://cache/b.json').blob();
  await meter.read(answer([1], { 'content-length': '900' }), 'http://cache/image.png').blob();
  await meter.read(answer([4, 6], { 'content-length': '1' }), 'http://cache/c.bin').arrayBuffer();
  assert.ok(rising(), `the share never goes down: ${shares()}`);
  assert.ok(
    shares()
      .slice(0, -1)
      .every((share) => share < 1),
    'full only on the last chunk',
  );
  assert.deepEqual(heard.at(-1), [26, 26]);
});

test('settle drops the planned files never read, and the last event is complete', async () => {
  const { heard, meter, rising } = listened();
  meter.plan(
    new Map([
      ['http://cache/read.bin', 3],
      ['http://cache/unread.bin', 100],
    ]),
  );
  await meter.read(answer([3]), 'http://cache/read.bin').arrayBuffer();
  assert.deepEqual(heard.at(-1), [3, 103]);
  meter.settle();
  assert.deepEqual(heard.at(-1), [3, 3]);
  await meter.read(answer([2]), 'http://cache/late.png').blob();
  assert.deepEqual(heard.at(-1), [5, 5], 'a read after the load keeps the count whole');
  assert.ok(rising());
});

test('a planned body shorter than declared gives its shortfall back, never lowering the share', async () => {
  const { heard, meter, rising } = listened();
  meter.plan(new Map([['http://cache/short.bin', 10]]));
  const body = meter.read(answer([3, 4]), 'http://cache/short.bin');
  assert.equal((await body.arrayBuffer()).byteLength, 7, 'the body reads whole through it');
  assert.deepEqual(heard.at(-1), [7, 7]);
  assert.ok(rising());
});

test('a manifest that declares no file is heard once, whole, when the load settles', async () => {
  const { heard, meter } = listened();
  meter.plan(new Map());
  await meter.read(answer([4, 4]), 'http://cache/clusters.json').arrayBuffer();
  assert.deepEqual(heard, [], 'no share is reported against an empty plan');
  meter.settle();
  assert.deepEqual(heard, [[8, 8]]);
});
