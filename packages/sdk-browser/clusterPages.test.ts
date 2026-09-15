import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256Hex } from './sha256Hex.ts';
import { loadClusterPages } from './clusterPages.ts';
test('a corrupt page aborts sibling fetches before they allocate remaining indices', async () => {
  const started: string[] = [],
    finished: string[] = [];
  const pages = [
    { url: 'good.bin', bytes: 4, sha256: 'pending' },
    { url: 'bad.bin', bytes: 4, sha256: 'nope' },
    { url: 'later.bin', bytes: 4, sha256: 'pending' },
  ];
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const sha = await sha256Hex(bytes.buffer);
  pages[0].sha256 = pages[2].sha256 = sha;
  const hold = Promise.withResolvers<void>();
  globalThis.fetch = async (url, init) => {
    const name = String(url).split('/').pop() ?? '';
    started.push(name);
    const signal = init?.signal;
    if (name === 'later.bin')
      await Promise.race([
        hold.promise,
        new Promise((_, reject) => {
          const fail = () => reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
          signal?.addEventListener('abort', fail, { once: true });
          if (signal?.aborted) fail();
        }),
      ]);
    finished.push(name);
    return new Response(bytes, { status: 200 });
  };
  try {
    const loading = loadClusterPages(pages, 'http://cache/', undefined, () => {});
    await assert.rejects(loading, /Corrupt cluster page/);
    hold.resolve();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(finished.includes('later.bin'), false);
  } finally {
    hold.resolve();
  }
});
