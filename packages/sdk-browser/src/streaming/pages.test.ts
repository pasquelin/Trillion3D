import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256Hex } from '../measurement/sha256Hex.ts';
import { createPageStreamer } from './pages.ts';
test('streamer fetches only requested pages and counts hits', async () => {
  const bytes = new Uint8Array([1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0]);
  const sha = await sha256Hex(bytes.buffer);
  const fetched: string[] = [];
  globalThis.fetch = async (url) => {
    fetched.push(String(url));
    return new Response(bytes, { status: 200 });
  };
  const streamer = createPageStreamer(
    [
      { url: 'a.bin', bytes: bytes.byteLength, sha256: sha },
      { url: 'b.bin', bytes: bytes.byteLength, sha256: sha },
    ],
    'http://cache/',
  );
  await streamer.request(['a.bin']);
  assert.deepEqual(fetched, ['http://cache/a.bin']);
  assert.equal(streamer.get('a.bin')?.[0], 1);
  assert.equal(streamer.get('b.bin'), undefined);
  await streamer.request(['a.bin']);
  assert.equal(streamer.stats().hits, 1);
  assert.equal(streamer.stats().loaded, 1);
  streamer.dispose();
});
test('streamer LRU evicts unpinned pages and retains pinned ones', async () => {
  const bytes = new Uint8Array([1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0]);
  const sha = await sha256Hex(bytes.buffer);
  globalThis.fetch = async () => new Response(bytes, { status: 200 });
  const streamer = createPageStreamer(
    [
      { url: 'a.bin', bytes: bytes.byteLength, sha256: sha },
      { url: 'b.bin', bytes: bytes.byteLength, sha256: sha },
      { url: 'c.bin', bytes: bytes.byteLength, sha256: sha },
    ],
    'http://cache/',
    undefined,
    2,
    2,
  );
  await streamer.request(['a.bin', 'b.bin']);
  assert.equal(streamer.stats().resident, 2);
  streamer.retain(['a.bin']);
  await streamer.request(['c.bin']);
  assert.equal(streamer.has('a.bin'), true);
  assert.equal(streamer.has('c.bin'), true);
  assert.equal(streamer.has('b.bin'), false);
  assert.ok(streamer.stats().evictions >= 1);
  streamer.dispose();
});
test('streamer notifies consumers when a page is evicted', async () => {
  const bytes = new Uint8Array([1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0]);
  const sha = await sha256Hex(bytes.buffer);
  globalThis.fetch = async () => new Response(bytes, { status: 200 });
  const dropped: string[] = [];
  const streamer = createPageStreamer(
    [
      { url: 'a.bin', bytes: bytes.byteLength, sha256: sha },
      { url: 'b.bin', bytes: bytes.byteLength, sha256: sha },
      { url: 'c.bin', bytes: bytes.byteLength, sha256: sha },
    ],
    'http://cache/',
    undefined,
    2,
    2,
    (url) => dropped.push(url),
  );
  await streamer.request(['a.bin', 'b.bin']);
  streamer.retain(['a.bin']);
  await streamer.request(['c.bin']);
  assert.ok(dropped.includes('b.bin'));
  streamer.dispose();
});

test('page failures stop after three attempts and remain observable without a per-frame retry loop', async () => {
  let attempts = 0;
  const previous = globalThis.fetch;
  globalThis.fetch = async () => {
    attempts++;
    return new Response('', { status: 503 });
  };
  const streamer = createPageStreamer(
    [{ url: 'bad.bin', bytes: 12, sha256: 'invalid' }],
    'http://cache/',
  );
  try {
    await assert.rejects(streamer.request(['bad.bin']), /PAGE_STREAM_FAILED.*bad.bin/);
    assert.equal(attempts, 3);
    for (let i = 0; i < 10; i++)
      await assert.rejects(streamer.request(['bad.bin']), /PAGE_STREAM_FAILED/);
    assert.equal(attempts, 3);
    assert.equal(streamer.failed('bad.bin'), true);
    assert.equal(streamer.stats().failed, 1);
  } finally {
    streamer.dispose();
    globalThis.fetch = previous;
  }
});

test('the bootstrap reader verifies pages and shares in-flight requests', async () => {
  const bytes = new Uint32Array([0, 1, 2]);
  const sha = await sha256Hex(bytes.buffer);
  let attempts = 0;
  const previous = globalThis.fetch;
  globalThis.fetch = async () => {
    attempts++;
    return new Response(bytes);
  };
  const streamer = createPageStreamer([{ url: 'a.bin', bytes: 12, sha256: sha }], 'http://cache/');
  try {
    const [a, b] = await Promise.all([streamer.read('a.bin'), streamer.read('a.bin')]);
    assert.deepEqual([...a], [0, 1, 2]);
    assert.equal(a, b);
    assert.equal(attempts, 1);
  } finally {
    streamer.dispose();
    globalThis.fetch = previous;
  }
});

test('cancellation stops outstanding loads without retrying or recording a source failure', async () => {
  const controller = new AbortController();
  let attempts = 0,
    release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const previous = globalThis.fetch;
  globalThis.fetch = async () => {
    attempts++;
    await gate;
    return new Response(new Uint32Array([0, 1, 2]));
  };
  const streamer = createPageStreamer(
    [{ url: 'a.bin', bytes: 12, sha256: 'unused' }],
    'http://cache/',
    controller.signal,
  );
  try {
    const job = streamer.read('a.bin');
    controller.abort();
    release();
    await assert.rejects(job, { name: 'AbortError' });
    assert.equal(attempts, 1);
    assert.equal(streamer.stats().failed, 0);
    assert.equal(streamer.stats().resident, 0);
  } finally {
    release();
    streamer.dispose();
    globalThis.fetch = previous;
  }
});
test('an identical pin list resets nothing, a list that changes resets everything', async () => {
  const bytes = new Uint8Array([1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0]);
  const sha = await sha256Hex(bytes.buffer);
  globalThis.fetch = async () => new Response(bytes, { status: 200 });
  const pages = ['a.bin', 'b.bin', 'c.bin'].map((url) => ({
    url,
    bytes: bytes.byteLength,
    sha256: sha,
  }));
  const evicted: string[] = [];
  // Budget of two pages: the third arrival must reclaim the slot of an unpinned one.
  const streamer = createPageStreamer(pages, 'http://cache/', undefined, 1, 2, (url) =>
    evicted.push(url),
  );
  await streamer.request(['a.bin', 'b.bin']);
  streamer.retain(['a.bin']);
  // The same list, returned in the array the host reuses: pins do not move.
  const scratch = ['a.bin'];
  streamer.retain(scratch);
  await streamer.request(['c.bin']);
  assert.deepEqual(evicted, ['b.bin'], 'the pinned page survived, the other did not');
  assert.equal(streamer.has('a.bin'), true);
  assert.equal(streamer.has('c.bin'), true);
  // The list changes: pins follow, and the formerly pinned page becomes reclaimable.
  scratch[0] = 'c.bin';
  streamer.retain(scratch);
  await streamer.request(['b.bin']);
  assert.deepEqual(evicted, ['b.bin', 'a.bin']);
  streamer.dispose();
});
