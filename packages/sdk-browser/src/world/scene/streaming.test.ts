// #982 (STR-07): `startFetch` serves each world page the moment its read lands — decoded while
// the others still travel —, not once the whole batch has. Port of the audit's `sim.mjs`: reads
// land in a seeded random order, one held back to the end; every other page reaches the backends
// before that last read lands, and what they receive is develop's batch (E0): the same pages, each
// decoded value by value as the in-place decode returns it — random pages, signed zeros, the
// one-triangle and the maximal page —, an index page queued once, a repeated and an uncatalogued
// address served as before. A refused page is refused as before and holds no other page back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createExplorerStreaming } from './streaming.ts';
import { createPageStreamer } from '../../streaming/pageStreamer.ts';
import { createFrameBudget } from '../../page/integration/frameBudget.ts';
import { decodeGeometryPage } from '../../page/decode/geometryPage.ts';
import { prepareSdkWasm } from '../../page/decode/geometryPageWasm.ts';
import { sha256Hex } from '../../streaming/sha256Hex.ts';
import { assertSamePage, edgePages, randomPage } from '../../page/decode/randomPages.fixture.ts';
import { seeded } from '../../../../../site/examples/kit/random.ts';
import type { DecodedGeometryPage } from '../../page/decode/geometryPage.ts';
import type { RenderBackend } from '../../backend/types.ts';
import type { ExplorerSession } from '../session/session.ts';

const MAX = 16 * 1024 * 1024;
const WASM = readFileSync(join(import.meta.dirname, '../../page/decode/pageCodec.wasm'));

/** A world of `bodies` pages under `url`s, served by a `fetch` that lands them in a seeded random
 *  order and holds `last` until `release`; the streaming of one explorer session reads it. */
async function world(bodies: Map<string, Uint8Array>, last: string) {
  const random = seeded(982);
  let release!: () => void;
  const held = new Promise<void>((done) => (release = done));
  const fetch = globalThis.fetch;
  globalThis.fetch = async (href) => {
    const url = new URL(String(href)).pathname.slice(1);
    await (url === last ? held : new Promise((done) => setTimeout(done, random() * 20)));
    return new Response(bodies.get(url)!.slice(), { status: 200 });
  };
  const pages = await Promise.all(
    [...bodies].map(async ([url, bytes]) => ({
      url,
      bytes: bytes.byteLength,
      sha256: await sha256Hex(bytes.slice().buffer),
    })),
  );
  const streamer = createPageStreamer(pages, 'http://world.test/');
  const geometry = new Map<string, DecodedGeometryPage>(),
    indices = new Map<string, Uint32Array>();
  const backend = {
    acceptGeometryPage: (url: string, page: DecodedGeometryPage) => geometry.set(url, page),
    acceptPage: (url: string, array: Uint32Array) => indices.set(url, array),
  } as unknown as RenderBackend;
  const budget = createFrameBudget(1e9);
  const session = { scope: 'world', emit() {}, diagnose() {} } as unknown as ExplorerSession;
  const geometryUrls = new Set(wgpUrls(bodies));
  const streaming = createExplorerStreaming(session, {
    streamer,
    geometryUrls,
    backends: [backend],
    state: { disposed: false, measuring: false, active: { metrics: () => ({}) } } as never,
    budget,
  });
  const done = () => {
    streamer.dispose();
    globalThis.fetch = fetch;
  };
  return { streaming, geometry, indices, release, done, budget };
}

test.before(async () => {
  assert.ok(await prepareSdkWasm(WASM), 'the real wasm module must instantiate');
});

test('each world page is served as it lands, and the batch is develop batch (E0)', async () => {
  const random = seeded(4);
  const bodies = new Map<string, Uint8Array>();
  for (const [rank, page] of edgePages(random).entries()) bodies.set(`edge${rank}.wgp`, page);
  for (let i = 0; i < 40; i++) bodies.set(`p${i}.wgp`, randomPage(random, 3 + ((i * 37) % 500)));
  bodies.set('index.bin', new Uint8Array(new Uint32Array([7, 0, 3, 9]).buffer));
  const last = 'p17.wgp';
  const { streaming, geometry, indices, release, done, budget } = await world(bodies, last);
  try {
    const urls = [...bodies.keys(), 'p3.wgp', 'absent.wgp'];
    streaming.startFetch(urls);
    // Every other page is served while the last read still travels: the batch no longer waits.
    const others = bodies.size - 2;
    for (let wait = 0; geometry.size < others && wait < 1000; wait++)
      await new Promise((tick) => setTimeout(tick, 10));
    assert.equal(geometry.size, others, 'pages served before the batch landed');
    assert.ok(!geometry.has(last));
    release();
    await streaming.promise;
    assert.deepEqual([...geometry.keys()].sort(), wgpUrls(bodies).sort());
    for (const url of wgpUrls(bodies)) {
      const oracle = decodeGeometryPage(bodies.get(url)!.slice(), MAX);
      assertSamePage(geometry.get(url)!, oracle, url);
    }
    assert.equal(streaming.arrivals.pending, 1, 'the index page is queued once');
    budget.open();
    streaming.arrivals.drain();
    assert.deepEqual([...indices.get('index.bin')!], [7, 0, 3, 9]);
    assert.equal(streaming.decodeFailures.size, 0);
  } finally {
    done();
  }
});

test('a refused page is refused as before and holds no other page back', async () => {
  const random = seeded(9);
  const bodies = new Map([
    ['good.wgp', randomPage(random, 90)],
    ['bad.wgp', randomPage(random, 30).slice(0, 100)],
    ['late.wgp', randomPage(random, 60)],
  ]);
  const { streaming, geometry, release, done } = await world(bodies, 'late.wgp');
  try {
    streaming.startFetch([...bodies.keys()]);
    release();
    await streaming.promise;
    assert.deepEqual([...streaming.decodeFailures], ['bad.wgp']);
    assert.deepEqual([...geometry.keys()].sort(), ['good.wgp', 'late.wgp']);
  } finally {
    done();
  }
});

function wgpUrls(bodies: Map<string, Uint8Array>) {
  return [...bodies.keys()].filter((url) => url.endsWith('.wgp'));
}
