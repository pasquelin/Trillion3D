import test from 'node:test';
import assert from 'node:assert/strict';
import { createReadWatch, type PageReads } from './readWatch.ts';

/** A watch over reads that settle when the test says: `land` or `drop` each url. */
function reads() {
  const pending = new Map<string, { land: () => void; drop: () => void }[]>();
  const subscribe = (url: string) =>
    new Promise<Uint8Array>((resolve, reject) => {
      const list = pending.get(url) ?? [];
      list.push({ land: () => resolve(new Uint8Array()), drop: () => reject(new Error('drop')) });
      pending.set(url, list);
    });
  const settle = async (url: string, how: 'land' | 'drop') => {
    pending.get(url)!.shift()![how]();
    await new Promise(setImmediate);
  };
  return { ...createReadWatch(subscribe), settle };
}

test('a watch hears pages read together once, each landing, a dropped read taken back (#408)', async () => {
  const { read, watch, settle } = reads();
  const heard: PageReads[] = [];
  const stop = watch((event) => heard.push(event));
  const caught = (url: string) => void read(url).catch(() => {});
  ['a', 'b', 'c', 'a'].forEach(caught);
  await Promise.resolve();
  assert.deepEqual(heard, [{ landed: 0, asked: 3 }], 'asked together: one event, each page once');
  await settle('a', 'land');
  await settle('a', 'land');
  await settle('b', 'drop');
  caught('c');
  await settle('c', 'drop');
  assert.deepEqual(heard.slice(1), [
    { landed: 1, asked: 3 },
    { landed: 1, asked: 3 }, // a page lands once
    { landed: 1, asked: 2 },
    { landed: 1, asked: 2 }, // read again
    { landed: 1, asked: 2 }, // one of its two reads dropped: still asked
  ]);
  await settle('c', 'land');
  stop();
  caught('d');
  await Promise.resolve();
  assert.deepEqual(heard.at(-1), { landed: 2, asked: 2 }, 'a page read by another reader lands');
  assert.equal(heard.length, 7, 'a stopped watch hears nothing more');
});
