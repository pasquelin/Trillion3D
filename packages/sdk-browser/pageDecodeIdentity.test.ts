// Batch H2: the three decode paths — WebAssembly, JavaScript, and the contract task run in
// place — must return exactly the same bytes, or refuse for the same cause. Hostile inputs:
// 65 535 vertices (the high bound), NaN/Infinity slipped in afterwards, a truncated page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PAGE_DECODE_PROTOCOL } from '../sdk-core/index.ts';
import { decodeGeometryPage } from './geometryPage.ts';
import { decodeGeometryPageWasm, prepareSdkWasm } from './geometryPageWasm.ts';
import { encodeGeometryPage } from '../page-codec/geometryPage.mjs';
import { runPageDecodeTask } from './pageDecodeTask.ts';
import type { PageDecodeDone } from '../sdk-core/index.ts';

const MAX = 16 * 1024 * 1024;
const MODULE = readFileSync(join(import.meta.dirname, 'pageCodec.wasm'));

test.before(async () => {
  assert.ok(await prepareSdkWasm(MODULE), 'the real wasm module must instantiate');
});

/** A value identical byte for byte on all three sides, or the first gap. */
function ecart(nom: string, a: Float32Array | Uint32Array, b: Float32Array | Uint32Array) {
  if (a.length !== b.length) return `${nom}: length ${a.length} ≠ ${b.length}`;
  for (let i = 0; i < a.length; i++)
    if (!Object.is(a[i], b[i])) return `${nom}[${i}]: ${a[i]} ≠ ${b[i]}`;
  return null;
}

async function trioIdentique(donnees: Uint8Array) {
  const enPlace = await decodeGeometryPage(donnees.slice(), MAX);
  const parWasm = await decodeGeometryPageWasm(donnees.slice(), MAX);
  const { answer } = await runPageDecodeTask({
    protocol: PAGE_DECODE_PROTOCOL,
    id: 1,
    op: 'decode',
    source: donnees.slice().buffer as ArrayBuffer,
    maxDecodedBytes: MAX,
  });
  assert.equal(answer.ok, true);
  const bon = answer as PageDecodeDone;
  assert.equal(bon.wasm, true, 'the preloaded wasm module must have done the task work');
  assert.equal(ecart('indices in-place/wasm', enPlace.indices, parWasm.indices), null);
  for (const nom of Object.keys(enPlace.attributes))
    assert.equal(ecart(nom, enPlace.attributes[nom], parWasm.attributes[nom]), null);
  return enPlace;
}

test('65 535 vertices — the high bound — decode identically on the three paths', async () => {
  const sommets = 65535;
  const position = new Float32Array(sommets * 3);
  for (let i = 0; i < sommets; i++) position.set([i * 0.001, -i * 0.001, 0], i * 3);
  const triangles = Math.floor(sommets / 3) * 3,
    indices = new Uint32Array(triangles);
  for (let i = 0; i < triangles; i++) indices[i] = (i * 7919) % sommets;
  const { data } = await encodeGeometryPage(indices, {
    POSITION: { itemSize: 3, array: position },
  });
  const enPlace = await trioIdentique(data as Uint8Array);
  assert.equal(enPlace.vertexCount, sommets);
});

test('a NaN, an Infinity and a -0 slipped into the page decode or refuse identically', async () => {
  const position = new Float32Array([1, 2, 3, -0, 5, 6, 7, 8, 9]);
  const original = Number.isFinite;
  // The reference codec refuses any non-finite attribute: it is bypassed to build a hostile but
  // structurally valid page, the only way to get NaN through the compressor.
  Object.defineProperty(Number, 'isFinite', { value: () => true, configurable: true });
  let data: Uint8Array;
  try {
    const avecNaN = new Float32Array([1, 2, 3, Number.NaN, 5, 6, Number.POSITIVE_INFINITY, 8, 9]);
    ({ data } = (await encodeGeometryPage([0, 1, 2], {
      POSITION: { itemSize: 3, array: avecNaN },
    })) as { data: Uint8Array });
  } finally {
    Object.defineProperty(Number, 'isFinite', { value: original, configurable: true });
  }
  await assert.rejects(() => decodeGeometryPage(data.slice(), MAX), /GEOMETRY_PAGE_NONFINITE/);
  await assert.rejects(() => decodeGeometryPageWasm(data.slice(), MAX), /GEOMETRY_PAGE_NONFINITE/);

  // -0 alone, for its part, is finite: it goes through the encoder normally and must stay -0, not 0, everywhere.
  const { data: propre } = await encodeGeometryPage([0, 1, 2], {
    POSITION: { itemSize: 3, array: position },
  });
  const enPlace = await trioIdentique(propre as Uint8Array);
  assert.ok(Object.is(enPlace.attributes.position[3], -0));
});

test('a page truncated after its header refuses GEOMETRY_PAGE_BOUNDS on the three paths', async () => {
  const { data } = await encodeGeometryPage([0, 1, 2], {
    POSITION: { itemSize: 3, array: new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9]) },
  });
  const tronquee = (data as Uint8Array).slice(0, 32 + 4); // accepted header, body cut.
  await assert.rejects(() => decodeGeometryPage(tronquee.slice(), MAX), /GEOMETRY_PAGE_BOUNDS/);
  await assert.rejects(() => decodeGeometryPageWasm(tronquee.slice(), MAX), /GEOMETRY_PAGE_BOUNDS/);
  const { answer } = await runPageDecodeTask({
    protocol: PAGE_DECODE_PROTOCOL,
    id: 2,
    op: 'decode',
    source: tronquee.slice().buffer as ArrayBuffer,
    maxDecodedBytes: MAX,
  });
  assert.equal(answer.ok, false);
  assert.equal((answer as { code: string }).code, 'GEOMETRY_PAGE_BOUNDS');
});
