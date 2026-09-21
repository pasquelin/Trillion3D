// Batch H2: the WebAssembly decoder loader and its JavaScript fallback. `prepareSdkWasm`
// remembers its decision for the whole process; each hostile scenario therefore imports a fresh
// instance of the module (different specifier, same file) so it does not inherit the others' cache.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeGeometryPage } from './geometryPage.ts';
import { encodeGeometryPage } from '../page-codec/geometryPage.mjs';

const MODULE = readFileSync(join(import.meta.dirname, 'pageCodec.wasm'));

type WasmModule = typeof import('./geometryPageWasm.ts');
let compteur = 0;
/** A fresh loader instance: its remembered `attente` has not decided anything yet. */
function frais(): Promise<WasmModule> {
  return import(`./geometryPageWasm.ts?fraicheur=${compteur++}`) as Promise<WasmModule>;
}

async function pageAvecMoinsZero() {
  const position = new Float32Array([-0, 0, 0, 1, 1, 1, 2, 2, 2]);
  const uv = new Float32Array([0, 0, 0.5, 0.5, 1, 1]);
  const { data } = encodeGeometryPage([0, 1, 2], {
    POSITION: { itemSize: 3, array: position },
    TEXCOORD_0: { itemSize: 2, array: uv },
  });
  return data as Uint8Array;
}

test('valid bytes instantiate the module and decode like the in-place path', async () => {
  const { decodeGeometryPageWasm, prepareSdkWasm } = await frais();
  assert.ok(await prepareSdkWasm(MODULE), 'the real module must instantiate');
  const donnees = await pageAvecMoinsZero();
  const parWasm = await decodeGeometryPageWasm(donnees.slice(), 1 << 20);
  const enPlace = decodeGeometryPage(donnees.slice(), 1 << 20);
  assert.deepEqual(Array.from(parWasm.indices), Array.from(enPlace.indices));
  for (const nom of Object.keys(enPlace.attributes)) {
    const a = parWasm.attributes[nom],
      b = enPlace.attributes[nom];
    for (let i = 0; i < b.length; i++) assert.ok(Object.is(a[i], b[i]), `${nom}[${i}]`);
  }
});

test('bytes that are not a valid WebAssembly module fail instantiation without throwing', async () => {
  const { decodeGeometryPageWasm, prepareSdkWasm } = await frais();
  assert.equal(await prepareSdkWasm(new Uint8Array([1, 2, 3, 4])), null);
  const donnees = await pageAvecMoinsZero();
  const parRepli = await decodeGeometryPageWasm(donnees.slice(), 1 << 20);
  const enPlace = decodeGeometryPage(donnees.slice(), 1 << 20);
  assert.deepEqual(Array.from(parRepli.indices), Array.from(enPlace.indices));
});

test('a simulated engine without SIMD — instantiation that throws — falls back to the JavaScript decoder', async () => {
  const { decodeGeometryPageWasm, prepareSdkWasm } = await frais();
  const original = WebAssembly.instantiate;
  // @ts-expect-error: simulates an engine that refuses to compile the module (SIMD missing, for example).
  WebAssembly.instantiate = () => {
    throw new WebAssembly.CompileError('simd absent');
  };
  try {
    assert.equal(await prepareSdkWasm(MODULE), null);
  } finally {
    WebAssembly.instantiate = original;
  }
  const donnees = await pageAvecMoinsZero();
  const parRepli = await decodeGeometryPageWasm(donnees.slice(), 1 << 20);
  assert.equal(parRepli.vertexCount, 3);
});

test('with no WebAssembly at all, instantiation returns null immediately', async () => {
  const { prepareSdkWasm } = await frais();
  const original = globalThis.WebAssembly;
  // @ts-expect-error: simulates a platform without WebAssembly.
  delete globalThis.WebAssembly;
  try {
    assert.equal(await prepareSdkWasm(MODULE), null);
  } finally {
    globalThis.WebAssembly = original;
  }
});

test('even once loaded, the module refuses a page that is too short before touching it', async () => {
  const { decodeGeometryPageWasm, prepareSdkWasm } = await frais();
  assert.ok(await prepareSdkWasm(MODULE));
  await assert.rejects(
    () => decodeGeometryPageWasm(new Uint8Array(10), 1 << 20),
    /GEOMETRY_PAGE_HEADER/,
  );
});

test('a forged index count is refused by both decoders before either allocates', async () => {
  // One vertex, so indices cost no bits and the layout still matches the header alone; three
  // times 2^30 indices, whose byte count wraps a 32-bit size to zero without saturation.
  const { decodeGeometryPageWasm, prepareSdkWasm } = await frais();
  assert.ok(await prepareSdkWasm(MODULE));
  const { data } = encodeGeometryPage([0, 0, 0], {
    POSITION: { itemSize: 3, array: new Float32Array([1, 2, 3]) },
  });
  const forged = (data as Uint8Array).slice();
  new DataView(forged.buffer).setUint32(3 * 4, 3 * 2 ** 30, true);
  assert.throws(() => decodeGeometryPage(forged.slice(), 1 << 24), /GEOMETRY_PAGE_BOUNDS/);
  await assert.rejects(
    () => decodeGeometryPageWasm(forged.slice(), 1 << 24),
    /GEOMETRY_PAGE_BOUNDS/,
  );
});
