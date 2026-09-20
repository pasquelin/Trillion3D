// Batch H2: the three decode paths — WebAssembly, JavaScript, and the contract task run in
// place — must return exactly the same bytes, or refuse for the same cause. Hostile inputs:
// 65 535 vertices (the high bound), every attribute with signed zeros, a forged index, a
// truncated page.
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
  const enPlace = decodeGeometryPage(donnees.slice(), MAX);
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
  const { data } = encodeGeometryPage(indices, {
    POSITION: { itemSize: 3, array: position },
  });
  const enPlace = await trioIdentique(data as Uint8Array);
  assert.equal(enPlace.vertexCount, sommets);
});

test('every attribute, signed zeros included, decodes identically; a forged index refuses identically', async () => {
  const position = new Float32Array([1, 2, 3, -0, 5, 6, 7, 8, 9]);
  const { data } = encodeGeometryPage([0, 1, 2], {
    POSITION: { itemSize: 3, array: position },
    NORMAL: { itemSize: 3, array: new Float32Array([0, 0, 1, 0, -1, 0, -0, 0, -1]) },
    TEXCOORD_0: { itemSize: 2, array: new Float32Array([0, 0, 0.5, -0, 1, 1]) },
    TEXCOORD_1: { itemSize: 2, array: new Float32Array([2, 2, 2.5, 2, 3, 3]) },
    COLOR_0: { itemSize: 4, array: new Float32Array([1, 0, 0, 1, 0, 1, 0, 0.5, 0, 0, 1, 1]) },
  });
  const enPlace = await trioIdentique(data as Uint8Array);
  // The grid has no signed zero: `-0` lands on the cell of `0` and comes back as `+0`.
  assert.ok(Object.is(enPlace.attributes.position[3], 0));
  assert.deepEqual(Object.keys(enPlace.attributes), ['position', 'normal', 'uv', 'uv2', 'color']);
  // An index past the vertex count, forged in the index stream (two bits per index).
  const forged = (data as Uint8Array).slice();
  forged[96] = 0b11_01_00;
  await assert.rejects(async () => decodeGeometryPage(forged.slice(), MAX), /GEOMETRY_PAGE_INDEX/);
  await assert.rejects(() => decodeGeometryPageWasm(forged.slice(), MAX), /GEOMETRY_PAGE_INDEX/);
});

test('a page truncated after its header refuses GEOMETRY_PAGE_BOUNDS on the three paths', async () => {
  const { data } = encodeGeometryPage([0, 1, 2], {
    POSITION: { itemSize: 3, array: new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9]) },
  });
  const tronquee = (data as Uint8Array).slice(0, 96 + 4); // accepted header, body cut.
  await assert.rejects(async () => decodeGeometryPage(tronquee.slice(), MAX), /GEOMETRY_PAGE_BOUNDS/);
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
