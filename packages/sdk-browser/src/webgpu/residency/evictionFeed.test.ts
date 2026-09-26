// The host reads the GPU cut's eviction queue page by page: it never walks the catalogue (#872).
import test from 'node:test';
import assert from 'node:assert/strict';
import type { PageRec } from '../../page/selection/selection.ts';
import type { GpuCut, GpuSelection } from '../../gpu/core/selection.ts';
import { createEvictionFeed } from './evictionFeed.ts';

test('the queue reaches the cache as addresses, reading only the listed records', () => {
  const catalogue = Array.from({ length: 10_000 }, (_, id) => ({ url: `p${id}` }) as PageRec);
  let reads = 0;
  const pages = new Proxy(catalogue, {
    get: (target, key) => (
      typeof key === 'string' && /^\d+$/.test(key) && reads++,
      target[key as never]
    ),
  });
  const orders: (readonly string[] | undefined)[] = [],
    slots: number[] = [];
  const cache = { slots: 4, evictInOrder: (order?: readonly string[]) => orders.push(order) };
  const feed = createEvictionFeed(pages, () => cache);
  const cut = { result: { evictPageIds: [7, 3, 9000] } } as GpuCut;
  const selection = { peek: () => cut, setPoolSlots: (n: number) => slots.push(n) } as GpuSelection;
  feed(selection);
  feed(selection);
  assert.deepEqual(orders, [['p7', 'p3', 'p9000']], 'once per readback');
  assert.equal(reads, 3);
  assert.deepEqual(slots, [4, 4], 'the cut follows the pool slots');
  feed(null);
  assert.deepEqual(orders.at(-1), undefined);
});
