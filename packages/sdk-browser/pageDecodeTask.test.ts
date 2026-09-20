// Batch H2: the contract's shared task — the work run as-is by the worker and by the fallback
// on the main thread. Hostile inputs: a page truncated before its header, a flipped magic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PAGE_DECODE_PROTOCOL } from '../sdk-core/index.ts';
import { decodeGeometryPage } from './geometryPage.ts';
import { encodeGeometryPage } from '../page-codec/geometryPage.mjs';
import { restorePageDecode, runPageDecodeTask } from './pageDecodeTask.ts';
import type { PageDecodeDone, PageDecodeFailed, PageDecodeRequest } from '../sdk-core/index.ts';

function requete(overrides: Partial<PageDecodeRequest>): PageDecodeRequest {
  return {
    protocol: PAGE_DECODE_PROTOCOL,
    id: 1,
    op: 'decode',
    source: new ArrayBuffer(0),
    maxDecodedBytes: 16 * 1024 * 1024,
    ...overrides,
  };
}

/** A page with three attributes, a `-0` value slipped into the position. */
async function pageAvecMoinsZero() {
  const position = new Float32Array([-0, 0, 0, 1, 1, 1, 2, 2, 2]);
  const normal = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]);
  const uv = new Float32Array([0, 0, 0.5, 0.5, 1, 1]);
  const { data } = encodeGeometryPage([0, 1, 2], {
    POSITION: { itemSize: 3, array: position },
    NORMAL: { itemSize: 3, array: normal },
    TEXCOORD_0: { itemSize: 2, array: uv },
  });
  return data as Uint8Array;
}

test('verify returns the fingerprint, the origin buffer byte for byte, and wasm false', async () => {
  const octets = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const { answer, transfer } = await runPageDecodeTask(
    requete({ op: 'verify', source: octets.buffer as ArrayBuffer, id: 42 }),
  );
  assert.equal(answer.ok, true);
  const bon = answer as PageDecodeDone;
  assert.equal(bon.id, 42);
  assert.equal(bon.wasm, false);
  assert.equal(bon.sha256?.length, 64);
  assert.equal(transfer.length, 1);
  assert.equal(transfer[0], bon.source);
  const rendus = new Uint8Array(bon.source!);
  for (let i = 0; i < octets.length; i++) assert.ok(Object.is(rendus[i], octets[i]));
});

test('decode returns the same buffers as in-place decode, attributes included', async () => {
  const donnees = await pageAvecMoinsZero();
  const surPlace = decodeGeometryPage(donnees.slice(), 16 * 1024 * 1024);
  const { answer, transfer } = await runPageDecodeTask(
    requete({ op: 'decode', source: donnees.slice().buffer as ArrayBuffer }),
  );
  assert.equal(answer.ok, true, (answer as PageDecodeFailed).message);
  const bon = answer as PageDecodeDone;
  const payload = bon.decoded!;
  assert.deepEqual(payload.names, Object.keys(surPlace.attributes));
  assert.equal(transfer.length, 1 + payload.attributes.length);
  assert.equal(transfer[0], payload.indices);
  for (let i = 0; i < payload.attributes.length; i++)
    assert.equal(transfer[1 + i], payload.attributes[i]);

  const restauree = restorePageDecode(payload);
  assert.deepEqual(Array.from(restauree.indices), Array.from(surPlace.indices));
  for (const nom of payload.names) {
    const a = restauree.attributes[nom],
      b = surPlace.attributes[nom];
    assert.equal(a.length, b.length, nom);
    for (let i = 0; i < a.length; i++) assert.ok(Object.is(a[i], b[i]), `${nom}[${i}]`);
  }
});

test('a page truncated before its header refuses GEOMETRY_PAGE_HEADER, origin message intact', async () => {
  const { answer } = await runPageDecodeTask(requete({ source: new ArrayBuffer(10) }));
  assert.equal(answer.ok, false);
  const mauvais = answer as PageDecodeFailed;
  assert.equal(mauvais.code, 'GEOMETRY_PAGE_HEADER');
  assert.equal(mauvais.message, 'GEOMETRY_PAGE_HEADER');
});

test('an altered magic or version refuses GEOMETRY_PAGE_VERSION', async () => {
  const donnees = await pageAvecMoinsZero();
  const alteree = donnees.slice();
  alteree[0] ^= 0xff; // First byte of the `WGP3` magic.
  const { answer } = await runPageDecodeTask(requete({ source: alteree.buffer as ArrayBuffer }));
  assert.equal(answer.ok, false);
  assert.equal((answer as PageDecodeFailed).code, 'GEOMETRY_PAGE_VERSION');
});

test('an arbitrary request identifier comes back unchanged in every form of answer', async () => {
  const { answer: ok } = await runPageDecodeTask(
    requete({ op: 'verify', source: new ArrayBuffer(4), id: 777 }),
  );
  assert.equal(ok.id, 777);
  const { answer: refus } = await runPageDecodeTask(
    requete({ op: 'decode', source: new ArrayBuffer(2), id: 778 }),
  );
  assert.equal(refus.id, 778);
});
