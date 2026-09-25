import { fakeDevice, written } from '../../../../../tests/kit/gpu/fakeDevice.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGpuPageCache } from './pages.ts';

const LIMITS = { maxBufferSize: 1024 };
// A slot is the size of the largest cluster: a small page that reuses it writes only its bytes,
// and the slot's tail keeps those of the previous page without anyone reading them — a row names
// its page offset and index count, and visibility as well as shading refuse any triangle beyond
// (`../../visibility/shader/visWgsl.ts:50`, `../../visibility/shader/shadeWgsl.ts:83`). Only the padding to the multiple
// of four that `writeBuffer` requires goes extra, as zeros. The three pages reuse the same slot,
// and the sample counts only what is actually transferred.
test('a reused GPU slot receives only the bytes of its page, padded to what the queue needs', async () => {
  const { device, writes } = fakeDevice({ limits: LIMITS });
  const octets: Record<string, number[]> = {
    large: [1, 2, 3, 4, 5, 6, 7, 8],
    small: [9, 10, 11, 12],
    odd: [13, 14, 15, 16, 17],
  };
  const source = { read: async (key: string) => new Uint8Array(octets[key]) };
  const cache = createGpuPageCache(device, source, { pageBytes: 8, slots: 1 });
  const pages = [await cache.load('large'), await cache.load('small'), await cache.load('odd')];
  const envois = writes.map((write) => [...written(write)]),
    slot = pages[0].slot;
  assert.deepEqual(envois, [octets.large, octets.small, [...octets.odd, 0, 0, 0]]);
  assert.deepEqual([pages[1].slot, pages[2].slot], [slot, slot]);
  assert.equal(writes[2].offset, slot * 8);
  assert.deepEqual([pages[0].bytes, pages[1].bytes, pages[2].bytes], [8, 4, 5]);
  assert.equal(cache.stats().uploadedBytes, 8 + 4 + 8);
});
test('a cache hit does not fence the whole GPU device', async () => {
  const { device, writes, fences } = fakeDevice({ limits: LIMITS });
  const cache = createGpuPageCache(
    device,
    { read: async () => new Uint8Array([1, 2, 3, 4]) },
    { pageBytes: 8, slots: 1 },
  );
  await cache.load('a');
  const afterLoad = fences();
  await cache.load('a');
  assert.equal(fences(), afterLoad);
  assert.equal(writes.length, 1);
});
test('page fetches overlap while GPU uploads stay ordered', async () => {
  const { device, writes } = fakeDevice({ limits: LIMITS });
  let current = 0,
    peak = 0;
  const source = {
    read: async () => {
      current++;
      peak = Math.max(peak, current);
      await Promise.resolve();
      current--;
      return new Uint8Array([1, 2, 3, 4]);
    },
  };
  const cache = createGpuPageCache(device, source, { pageBytes: 8, slots: 2 });
  await Promise.all([cache.load('a'), cache.load('b')]);
  assert.equal(peak, 2);
  assert.equal(writes.length, 2);
  assert.notEqual(writes[0].offset, writes[1].offset);
});
test('storage binding size is rejected before buffer creation', () => {
  assert.throws(
    () =>
      createGpuPageCache(
        fakeDevice({
          limits: { maxBufferSize: 1024, maxStorageBufferBindingSize: 8 },
          refuse: () => 'throw',
        }).device,
        { read: async () => new Uint8Array(4) },
        { pageBytes: 8, slots: 2 },
      ),
    /INVALID_PAGE_BUDGET/,
  );
});
test('dispose aborts an in-flight load and does not write after destroy', async () => {
  const { device, writes, destroyed } = fakeDevice({ limits: LIMITS });
  let resume!: () => void;
  const source = {
    read: async (_key: string, signal?: AbortSignal) =>
      new Promise<Uint8Array>((resolve, reject) => {
        const fail = () => reject(signal?.reason ?? new Error('aborted'));
        signal?.addEventListener('abort', fail, { once: true });
        if (signal?.aborted) {
          fail();
          return;
        }
        resume = () => resolve(new Uint8Array([1, 2, 3, 4]));
      }),
  };
  const cache = createGpuPageCache(device, source, { pageBytes: 8, slots: 1 });
  const pending = cache.load('a');
  const closed = cache.dispose();
  resume?.();
  await assert.rejects(pending);
  await closed;
  assert.equal(writes.length, 0);
  assert.equal(destroyed.length, 1);
});
test('unload releases an unpinned slot so later loads can reuse it', async () => {
  const { device, writes } = fakeDevice({ limits: LIMITS });
  const cache = createGpuPageCache(
    device,
    { read: async () => new Uint8Array([1, 2, 3, 4]) },
    { pageBytes: 8, slots: 1 },
  );
  await cache.load('a');
  assert.equal(cache.unload('a'), true);
  assert.equal(cache.get('a'), undefined);
  await cache.load('b');
  assert.equal(writes.length, 2);
});
test('an aborted concurrent load does not prevent a separate non-aborted load for the same key', async () => {
  const { device, writes } = fakeDevice({ limits: LIMITS });
  const controller = new AbortController();
  const source = {
    read: async (_key: string, signal?: AbortSignal) => {
      if (signal?.aborted) throw signal.reason ?? new Error('aborted');
      return new Promise<Uint8Array>((resolve, reject) => {
        const fail = () => reject(signal?.reason ?? new Error('aborted'));
        signal?.addEventListener('abort', fail, { once: true });
        setTimeout(() => resolve(new Uint8Array([1, 2, 3, 4])), 10);
      });
    },
  };
  const cache = createGpuPageCache(device, source, { pageBytes: 8, slots: 1 });
  const load1 = cache.load('a', controller.signal);
  const load2 = cache.load('a');
  controller.abort(new Error('abort load1'));
  await assert.rejects(load1, /abort load1/);
  const page = await load2;
  assert.equal(page.key, 'a');
  assert.equal(writes.length, 1);
});
test('GPU diagnostics expose queue, read, upload, pins and eviction while observer errors stay isolated', async () => {
  const { device } = fakeDevice({ limits: LIMITS });
  const events: string[] = [];
  const cache = createGpuPageCache(
    device,
    { read: async () => new Uint8Array([1, 2, 3, 4]) },
    {
      pageBytes: 8,
      slots: 1,
      onDiagnostic: (event) => {
        events.push(event.phase);
        throw new Error('observer failure');
      },
    },
  );
  const first = await cache.load('a');
  await cache.load('a');
  cache.pin('a');
  assert.equal(cache.unload('a'), false);
  cache.unpin('a');
  assert.equal(cache.unload('a'), true);
  assert.ok(events.includes('gpu-page-catalogue'));
  assert.ok(events.includes('gpu-page-queue-wait'));
  assert.ok(events.includes('gpu-page-read-end'));
  assert.ok(events.includes('gpu-page-upload'));
  assert.ok(events.includes('gpu-page-cache-hit'));
  assert.ok(events.includes('gpu-page-pin'));
  assert.ok(events.includes('gpu-page-unload-refused'));
  assert.equal(first.generation, 1);
  await cache.dispose();
});
test('GPU page read retries once and reports the failed status without changing the load result', async () => {
  const { device } = fakeDevice({ limits: LIMITS });
  let attempts = 0;
  const phases: Array<{ phase: string; context: Record<string, unknown> }> = [];
  const cache = createGpuPageCache(
    device,
    {
      read: async () => {
        attempts++;
        if (attempts === 1) throw new Error('PAGE_HTTP_503');
        return new Uint8Array([1, 2, 3, 4]);
      },
    },
    { pageBytes: 8, slots: 1, onDiagnostic: (event) => phases.push(event) },
  );
  const page = await cache.load('retry');
  assert.equal(page.key, 'retry');
  assert.equal(attempts, 2);
  assert.ok(phases.some((event) => event.phase === 'gpu-page-retry'));
  assert.ok(
    phases.some((event) => event.phase === 'gpu-page-attempt-end' && event.context.status === 503),
  );
  await cache.dispose();
});
