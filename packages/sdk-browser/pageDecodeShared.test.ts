// Lot « mémoire partagée des pages » : la page revient par la région du créneau au lieu de voyager
// par message, et doit rendre exactement les mêmes octets. Entrées hostiles : plus de pages que de
// créneaux, un worker qui meurt au milieu d'une page, une page qui ne tient pas dans sa région, et
// la garde fausse — le seul cas où rien ne doit changer du chemin d'avant.
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

/** Une page réelle, avec un attribut facultatif pour que les noms voyagent vraiment. */
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
  const { data } = await encodeGeometryPage(indices, {
    POSITION: { itemSize: 3, array: position },
    NORMAL: { itemSize: 3, array: normal },
  });
  return data as Uint8Array;
}

/** Le premier écart entre deux pages décodées, ou `null` si elles sont identiques valeur par valeur. */
function ecartPage(a: DecodedGeometryPage, b: DecodedGeometryPage) {
  if (a.vertexCount !== b.vertexCount) return `sommets ${a.vertexCount} ≠ ${b.vertexCount}`;
  if (a.flags !== b.flags) return `drapeaux ${a.flags} ≠ ${b.flags}`;
  if (a.decodedBytes !== b.decodedBytes) return `octets ${a.decodedBytes} ≠ ${b.decodedBytes}`;
  const noms = Object.keys(a.attributes);
  if (noms.join() !== Object.keys(b.attributes).join()) return `noms ${noms.join()}`;
  for (const [nom, gauche] of [
    ['indices', a.indices] as const,
    ...noms.map((nom) => [nom, a.attributes[nom]] as const),
  ]) {
    const droite = nom === 'indices' ? b.indices : b.attributes[nom];
    if (gauche.length !== droite.length) return `${nom}: longueur ${gauche.length}`;
    for (let i = 0; i < gauche.length; i++)
      if (!Object.is(gauche[i], droite[i])) return `${nom}[${i}]: ${gauche[i]} ≠ ${droite[i]}`;
  }
  return null;
}

function decodee(answer: PageDecodeAnswer) {
  assert.equal(answer.ok, true, answer.ok ? '' : answer.message);
  const done = answer as PageDecodeDone;
  assert.ok(done.decoded, 'la réponse doit porter une page');
  return restorePageDecode(done.decoded!);
}

/** Une page décodée par un pool, avec ou sans arène de mémoire partagée. */
async function parPool(octets: Uint8Array, slots: number, partagee: boolean, copies = 1) {
  const arena = partagee ? createPageArena(slots) : undefined;
  const pool = createPageDecodePool(slots, arena);
  assert.equal(await pool.start(), true, 'le pool doit démarrer');
  const pages = await Promise.all(
    Array.from(
      { length: copies },
      () => pool.submit('decode', octets.slice().buffer as ArrayBuffer, MAX).answer,
    ),
  );
  pool.retire();
  return { pages: pages.map(decodee), arena };
}

test('une page revenue par la mémoire partagée est identique, valeur par valeur, à la même page transférée', () =>
  withNodeWorkerShim(NodeDomWorker, async () => {
    const octets = await page();
    const { pages, arena } = await parPool(octets, 1, true);
    const { pages: transferees } = await parPool(octets, 1, false);
    assert.equal(
      sharedField(arena!, 0, STATUS),
      SHARED_BY_REGION,
      'la page doit être passée par la région, pas par un message',
    );
    assert.equal(ecartPage(pages[0], transferees[0]), null);
    assert.deepEqual(Object.keys(pages[0].attributes), ['position', 'normal']);
  }));

test('plus de pages que de créneaux : chacune revient entière, le créneau se réutilise', () =>
  withNodeWorkerShim(NodeDomWorker, async () => {
    const octets = await page();
    const { pages: reference } = await parPool(octets, 1, false);
    const { pages } = await parPool(octets, 2, true, 9);
    assert.equal(pages.length, 9);
    for (const [rang, obtenue] of pages.entries())
      assert.equal(ecartPage(obtenue, reference[0]), null, `page ${rang}`);
  }));

test('un worker mort au milieu d’une page libère son créneau et rend PAGE_DECODE_WORKER', () =>
  withNodeWorkerShim(FlakyNodeWorker as unknown as typeof NodeDomWorker, async () => {
    const arena = createPageArena(1);
    const pool = createPageDecodePool(1, arena);
    assert.equal(await pool.start(), true);
    const answer = await pool.submit('decode', new ArrayBuffer(64), MAX).answer;
    assert.equal(answer.ok, false);
    assert.equal((answer as { code: string }).code, 'PAGE_DECODE_WORKER');
    await new Promise((r) => setTimeout(r, 20)); // le réveil du créneau est asynchrone.
    assert.equal(sharedField(arena, 0, STATE), SHARED_FREE, 'le créneau doit être rendu');
  }));

test('la garde décide seule du chemin annoncé, et Node sans isolement reste sur le transfert', () => {
  assert.equal(sharedPagesAllowed(), false, 'Node n’est pas isolé entre origines');
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

test('une page trop grande, ou trop d’attributs, n’est pas écrite : elle repart par transfert', () => {
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
  assert.equal(sharedField(arena, 0, STATE), SHARED_FREE, 'un refus ne publie rien');
  assert.equal(writeSharedPage(arena, 0, done([new ArrayBuffer(4)])), true);
});
