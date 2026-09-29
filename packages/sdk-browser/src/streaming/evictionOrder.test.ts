// The page cache's eviction order (`evictionOrder.ts`): the victims `evictOldest` takes, without
// ever looking at a held page, and the held bytes as a running total.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvictionOrder } from './evictionOrder.ts';
import { evictOldest } from './evictOldest.ts';
import { random } from '../page/cut/cutRuleChecks.fixture.ts';

/** A cache as `pageCache.ts` keeps it: a `Map` in recency order, and its eviction order. */
function cache() {
  const pages = new Map<string, number>();
  const order = createEvictionOrder((key) => pages.get(key)!);
  return {
    pages,
    order,
    touch(key: string, bytes: number) {
      order.drop(key);
      pages.delete(key);
      pages.set(key, bytes);
      order.touch(key);
    },
    drop(key: string) {
      order.drop(key);
      pages.delete(key);
    },
  };
}

test('one eviction past P held pages checks over() twice and evicts the one victim, whatever P', () => {
  for (const held of [0, 1, 1000, 100_000]) {
    const { order, touch, drop } = cache();
    for (let i = 0; i < held + 2; i++) touch(`p${i}`, 1);
    for (let i = 0; i < held; i++) order.hold(`p${i}`);
    let checks = 0,
      left = 1;
    const victims: string[] = [];
    const over = () => {
      checks++;
      return left > 0;
    };
    const evicted = order.evict(over, (key) => {
      left--;
      victims.push(key);
      drop(key);
    });
    assert.equal(evicted, 1);
    assert.deepEqual(victims, [`p${held}`], `the oldest page not held, past ${held} held`);
    assert.equal(checks, 2, `one check per victim and one to stop, past ${held} held`);
    assert.equal(order.heldBytes, held);
    if (held === 0) continue;
    // The held state changes: the oldest page is let go, the next victim held. The first is next.
    order.release('p0');
    order.hold(`p${held + 1}`);
    checks = 0;
    left = 2;
    const second = order.evict(over, (key) => {
      left--;
      victims.push(key);
      drop(key);
    });
    assert.equal(second, 1, 'the one page let go, then nothing but held pages');
    assert.deepEqual(victims.slice(1), ['p0']);
    assert.equal(checks, 1, 'one check per victim; the heap is then empty: none per held page');
    assert.equal(order.heldBytes, held);
  }
});

test('random touches, drops, holds and evictions: the victims of evictOldest, one by one', () => {
  for (const seed of [1, 7, 914, 2026]) {
    const draw = random(seed);
    const { pages, order, touch, drop } = cache();
    const held = new Set<string>();
    const keys = Array.from({ length: 48 }, (_, i) => `k${i}`);
    for (let step = 0; step < 4000; step++) {
      const key = keys[Math.floor(draw() * keys.length)],
        roll = draw();
      if (roll < 0.35) touch(key, 1 + Math.floor(draw() * 100));
      else if (roll < 0.45) drop(key);
      else if (roll < 0.6) {
        held.add(key);
        order.hold(key);
      } else if (roll < 0.75) {
        held.delete(key);
        order.release(key);
      } else if (roll < 0.8) {
        order.releaseAll();
        held.clear();
      } else {
        // Both sides evict the same count from copies of the same state: the develop walk over
        // the Map's order, and the heap.
        const want = Math.floor(draw() * 6);
        const walked = new Map(pages),
          expected: string[] = [],
          got: string[] = [];
        let left = want;
        const take = (into: string[], out: (k: string) => unknown) => (k: string) => {
          left--;
          into.push(k);
          out(k);
        };
        evictOldest(walked.keys(), () => left > 0, (k) => held.has(k), take(expected, (k) => walked.delete(k)));
        left = want;
        order.evict(() => left > 0, take(got, drop));
        assert.deepEqual(got, expected, `seed ${seed}, step ${step}`);
        assert.deepEqual([...pages.keys()], [...walked.keys()]);
      }
      let recount = 0;
      for (const [k, bytes] of pages) if (held.has(k)) recount += bytes;
      assert.equal(order.heldBytes, recount, `held bytes, seed ${seed}, step ${step}`);
    }
  }
});

test('a cleared cache keeps its holds: a page pinned before it comes back stays out of reach', () => {
  const { order, touch, drop, pages } = cache();
  touch('a', 4);
  touch('b', 4);
  order.hold('a');
  order.clear();
  pages.clear();
  assert.equal(order.heldBytes, 0);
  touch('a', 8);
  touch('b', 8);
  assert.equal(order.heldBytes, 8);
  const victims: string[] = [];
  order.evict(
    () => true,
    (k) => {
      victims.push(k);
      drop(k);
    },
  );
  assert.deepEqual(victims, ['b']);
});
