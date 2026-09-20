// Lot "shared page memory": the page comes back through the slot region instead of
// travelling by message, and must return exactly the same bytes. Hostile inputs: more
// pages than slots, a worker that dies mid-page, a page that does not fit in its region,
// and the false retain — the only case where nothing must change from the previous path.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PAGE_DECODE_PROTOCOL } from '../sdk-core/index.ts';
import { createPageDecodePool } from './pageDecodePool.ts';
import { restorePageDecode } from './pageDecodeTask.ts';
import {
  MAX_SHARED_ATTRS,
  SHARED_BY_REGION,
  SHARED_FREE,
  STATUS,
  SHARED_REGION_BYTES,
  STATE,
  createPageArena,
  pageDecodeTransport,
  sharedField,
  sharedPagesAllowed,
} from './pageDecodeShared.ts';
import { writeSharedPage } from './pageDecodeSharedPage.ts';
import { encodeGeometryPage } from '../page-codec/geometryPage.mjs';
import {
  FlakyNodeWorker,
  NodeDomWorker,
  withNodeWorkerShim,
} from './bench/oracles/pageDecodeNodeWorker.mjs';
import type { DecodedGeometryPage } from './geometryPage.ts';
import type { PageDecodeAnswer, PageDecodeDone } from '../sdk-core/index.ts';

const MAX = 16 * 1024 * 1024;

/** A real page, with an optional attribute so names actually travel. */
async function page() {
  const sommets = 64;
  const position = new Float32Array(sommets * 3),
    normal = new Float32Array(sommets * 3);
  for (let i = 0; i < sommets; i++) {
    position.set([i * 0.5, -i * 0.25, i === 3 ? -0 : i], i * 3);
    normal.set([0, 1, 0], i * 3);
  }
  const indices = new Uint32Array(sommets - (sommets % 3));
  for (let i = 0; i < indices.length; i++) indices[i] = (i * 7) % sommets;
  const { data } = encodeGeometryPage(indices, {
    POSITION: { itemSize: 3, array: position },
    NORMAL: { itemSize: 3, array: normal },
  });
  return data as Uint8Array;
}

/** First difference between two decoded pages, or `null` if they are identical value by value. */
function ecartPage(a: DecodedGeometryPage, b: DecodedGeometryPage) {
  if (a.vertexCount !== b.vertexCount) return `vertices ${a.vertexCount} ≠ ${b.vertexCount}`;
  if (a.flags !== b.flags) return `flags ${a.flags} ≠ ${b.flags}`;
  if (a.decodedBytes !== b.decodedBytes) return `bytes ${a.decodedBytes} ≠ ${b.decodedBytes}`;
  const noms = Object.keys(a.attributes);
  if (noms.join() !== Object.keys(b.attributes).join()) return `names ${noms.join()}`;
  for (const [nom, gauche] of [
    ['indices', a.indices] as const,
    ...noms.map((nom) => [nom, a.attributes[nom]] as const),
  ]) {
    const droite = nom === 'indices' ? b.indices : b.attributes[nom];
    if (gauche.length !== droite.length) return `${nom}: length ${gauche.length}`;
    for (let i = 0; i < gauche.length; i++)
      if (!Object.is(gauche[i], droite[i])) return `${nom}[${i}]: ${gauche[i]} ≠ ${droite[i]}`;
  }
  return null;
}

function decodee(answer: PageDecodeAnswer) {
  assert.equal(answer.ok, true, answer.ok ? '' : answer.message);
  const done = answer as PageDecodeDone;
  assert.ok(done.decoded, 'the answer must carry a page');
  return restorePageDecode(done.decoded!);
}

/** A page decoded by a pool, with or without a shared memory arena. */
async function parPool(octets: Uint8Array, slots: number, partagee: boolean, copies = 1) {
  const arena = partagee ? createPageArena(slots) : undefined;
  const pool = createPageDecodePool(slots, arena);
  assert.equal(await pool.start(), true, 'the pool must start');
  const pages = await Promise.all(
    Array.from(
      { length: copies },
      () => pool.submit('decode', octets.slice().buffer as ArrayBuffer, MAX).answer,
    ),
  );
  pool.retire();
  return { pages: pages.map(decodee), arena };
}

test('a page returned through shared memory is identical, value by value, to the same transferred page', () =>
  withNodeWorkerShim(NodeDomWorker, async () => {
    const octets = await page();
    const { pages, arena } = await parPool(octets, 1, true);
    const { pages: transferees } = await parPool(octets, 1, false);
    assert.equal(
      sharedField(arena!, 0, STATUS),
      SHARED_BY_REGION,
      'the page must have gone through the region, not a message',
    );
    assert.equal(ecartPage(pages[0], transferees[0]), null);
    assert.deepEqual(Object.keys(pages[0].attributes), ['position', 'normal']);
  }));

test('more pages than slots: each comes back whole, the slot is reused', () =>
  withNodeWorkerShim(NodeDomWorker, async () => {
    const octets = await page();
    const { pages: reference } = await parPool(octets, 1, false);
    const { pages } = await parPool(octets, 2, true, 9);
    assert.equal(pages.length, 9);
    for (const [rang, obtenue] of pages.entries())
      assert.equal(ecartPage(obtenue, reference[0]), null, `page ${rang}`);
  }));

test('a worker dead mid-page frees its slot and returns PAGE_DECODE_WORKER', () =>
  withNodeWorkerShim(FlakyNodeWorker as unknown as typeof NodeDomWorker, async () => {
    const arena = createPageArena(1);
    const pool = createPageDecodePool(1, arena);
    assert.equal(await pool.start(), true);
    const answer = await pool.submit('decode', new ArrayBuffer(64), MAX).answer;
    assert.equal(answer.ok, false);
    assert.equal((answer as { code: string }).code, 'PAGE_DECODE_WORKER');
    await new Promise((r) => setTimeout(r, 20)); // slot wake is asynchronous.
    assert.equal(sharedField(arena, 0, STATE), SHARED_FREE, 'the slot must be returned');
  }));

test('cross-origin isolation alone decides the announced path, and Node without isolation stays on transfer', () => {
  assert.equal(sharedPagesAllowed(), false, 'Node is not cross-origin isolated');
  assert.equal(pageDecodeTransport(), 'transfert');
  const scope = globalThis as { crossOriginIsolated?: boolean };
  try {
    scope.crossOriginIsolated = true;
    assert.equal(sharedPagesAllowed(), true);
    assert.equal(pageDecodeTransport(), 'partage');
  } finally {
    delete scope.crossOriginIsolated;
  }
  assert.equal(pageDecodeTransport(), 'transfert');
});

test('a page too large, or with too many attributes, is not written: it leaves by transfer', () => {
  const arena = createPageArena(1);
  const done = (attributs: ArrayBuffer[]): PageDecodeDone => ({
    protocol: PAGE_DECODE_PROTOCOL,
    id: 1,
    ok: true,
    sha256: null,
    source: null,
    decoded: {
      indices: new ArrayBuffer(4),
      names: attributs.map((_, i) => `a${i}`),
      attributes: attributs,
      vertexCount: 1,
      flags: 0,
      decodedBytes: 72,
    },
    wasm: false,
    taskMs: 0,
  });
  assert.equal(writeSharedPage(arena, 0, done([new ArrayBuffer(SHARED_REGION_BYTES)])), false);
  const trop = Array.from({ length: MAX_SHARED_ATTRS + 1 }, () => new ArrayBuffer(4));
  assert.equal(writeSharedPage(arena, 0, done(trop)), false);
  assert.equal(sharedField(arena, 0, STATE), SHARED_FREE, 'a refusal publishes nothing');
  assert.equal(writeSharedPage(arena, 0, done([new ArrayBuffer(4)])), true);
});
