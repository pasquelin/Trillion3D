import test from 'node:test';
import assert from 'node:assert/strict';
import { createReadWatch, type PageReads } from './readWatch.ts';
import { PRIORITY_PREFETCH } from './priority.ts';

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

test('a watch hears the reads the view waits on: each page once, a dropped one taken back (#408)', async () => {
  const { read, watch, settle } = reads();
  const heard: PageReads[] = [];
  const { stop, hold, reads: now } = watch((event) => heard.push(event));
  const caught = (url: string, priority?: number) =>
    void read(url, undefined, priority).catch(() => {});
  ['a', 'b', 'c', 'a'].forEach((url) => caught(url));
  caught('ahead', PRIORITY_PREFETCH);
  await Promise.resolve();
  assert.deepEqual(heard, [{ landed: 0, asked: 3 }], 'one event for a task; a prefetch unheard');
  await settle('a', 'land');
  await settle('b', 'drop');
  caught('c');
  await settle('c', 'drop');
  assert.deepEqual(heard.slice(1), [
    { landed: 1, asked: 3 },
    { landed: 1, asked: 2 }, // b dropped
    { landed: 1, asked: 2 }, // c read again
    { landed: 1, asked: 2 }, // one of its two reads dropped: still asked
  ]);
  await settle('c', 'land');
  hold('c');
  hold('held');
  assert.deepEqual(now(), { landed: 3, asked: 3 }, 'a held page counts once, landed');
  stop();
  caught('d');
  await settle('a', 'land');
  assert.equal(heard.length, 6, 'a stopped watch hears nothing more');
  assert.deepEqual(now(), { landed: 3, asked: 3 });
});
