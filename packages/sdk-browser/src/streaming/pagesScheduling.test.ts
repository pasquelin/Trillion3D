import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256Hex } from '../measurement/sha256Hex.ts';
import { createPageStreamer } from './pageStreamer.ts';
test('a priority read overtakes queued detail without exceeding one transfer', async () => {
  const bytes = new Uint32Array([0, 1, 2]);
  const sha = await sha256Hex(bytes.buffer);
  const started: string[] = [],
    previous = globalThis.fetch;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  globalThis.fetch = async (url) => {
    const name = String(url).split('/').at(-1)!;
    started.push(name);
    if (name === 'a.bin') await gate;
    return new Response(bytes);
  };
  const pages = ['a.bin', 'b.bin', 'c.bin'].map((url) => ({ url, bytes: 12, sha256: sha }));
  const streamer = createPageStreamer(pages, 'http://cache/', {
    workerCount: 1,
    maxTransferBytes: 12,
  });
  try {
    const detail = streamer.request(['a.bin', 'b.bin'], { priority: 2 });
    const urgent = streamer.read('c.bin');
    assert.deepEqual(started, ['a.bin']);
    assert.equal(streamer.stats().transferInFlightBytes, 12);
    release();
    await Promise.all([detail, urgent]);
    assert.deepEqual(started, ['a.bin', 'c.bin', 'b.bin']);
    assert.equal(streamer.stats().transferInFlightBytes, 0);
  } finally {
    release();
    streamer.dispose();
    globalThis.fetch = previous;
  }
});

test('cancelling obsolete detail leaves a shared page request alive', async () => {
  const bytes = new Uint32Array([0, 1, 2]);
  const sha = await sha256Hex(bytes.buffer);
  const previous = globalThis.fetch;
  let release!: () => void,
    attempts = 0;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  globalThis.fetch = async () => {
    attempts++;
    await gate;
    return new Response(bytes);
  };
  const streamer = createPageStreamer(
    [{ url: 'shared.bin', bytes: 12, sha256: sha }],
    'http://cache/',
    { workerCount: 1 },
  );
  const obsolete = new AbortController();
  try {
    const old = streamer.request(['shared.bin'], { signal: obsolete.signal });
    const current = streamer.read('shared.bin');
    obsolete.abort();
    release();
    await assert.rejects(old, { name: 'AbortError' });
    assert.deepEqual([...(await current)], [0, 1, 2]);
    assert.equal(attempts, 1);
    assert.equal(streamer.stats().failed, 0);
  } finally {
    release();
    streamer.dispose();
    globalThis.fetch = previous;
  }
});

test('stream diagnostics cover coalescing, verification, retention and eviction', async () => {
  const bytes = new Uint8Array([1, 0, 0, 0]);
  const sha = await sha256Hex(bytes.buffer);
  const previous = globalThis.fetch;
  globalThis.fetch = async () => new Response(bytes);
  const events: string[] = [];
  const streamer = createPageStreamer(
    [
      { url: 'a.bin', bytes: 4, sha256: sha },
      { url: 'b.bin', bytes: 4, sha256: sha },
    ],
    'http://cache/',
    {
      workerCount: 2,
      maxPages: 1,
      maxTransferBytes: 8,
      onDiagnostic: (event) => {
        events.push(event.phase);
        if (events.length === 1) throw new Error('observer failure');
      },
    },
  );
  try {
    await Promise.all([streamer.read('a.bin'), streamer.read('a.bin')]);
    streamer.retain([]);
    await streamer.request(['b.bin']);
    streamer.retain(['b.bin']);
    assert.ok(events.includes('page-catalogue'));
    assert.ok(events.includes('page-request-coalesced'));
    assert.ok(events.includes('page-hash-check'));
    assert.ok(events.includes('page-cache-eviction'));
    assert.ok(streamer.stats().evictions > 0);
  } finally {
    streamer.dispose();
    globalThis.fetch = previous;
  }
});
