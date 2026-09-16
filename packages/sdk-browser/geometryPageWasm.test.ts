// Lot H2 : le chargeur du décodeur WebAssembly et son repli JavaScript. `prepareSdkWasm`
// mémorise sa décision pour tout le process ; chaque scénario hostile importe donc une instance
// fraîche du module (spécificateur différent, même fichier) pour ne pas hériter du cache des autres.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeGeometryPage } from './geometryPage.ts';
import { encodeGeometryPage } from '../page-codec/geometryPage.mjs';

const MODULE = readFileSync(join(import.meta.dirname, 'pageCodec.wasm'));

type WasmModule = typeof import('./geometryPageWasm.ts');
let compteur = 0;
/** Une instance fraîche du chargeur : son `attente` mémorisé n'a encore rien décidé. */
function frais(): Promise<WasmModule> {
  return import(`./geometryPageWasm.ts?fraicheur=${compteur++}`) as Promise<WasmModule>;
}

async function pageAvecMoinsZero() {
  const position = new Float32Array([-0, 0, 0, 1, 1, 1, 2, 2, 2]);
  const uv = new Float32Array([0, 0, 0.5, 0.5, 1, 1]);
  const { data } = await encodeGeometryPage([0, 1, 2], {
    POSITION: { itemSize: 3, array: position },
    TEXCOORD_0: { itemSize: 2, array: uv },
  });
  return data as Uint8Array;
}

test('des octets valides instancient le module et décodent comme le chemin en place', async () => {
  const { decodeGeometryPageWasm, prepareSdkWasm } = await frais();
  assert.ok(await prepareSdkWasm(MODULE), 'le module réel doit s’instancier');
  const donnees = await pageAvecMoinsZero();
  const parWasm = await decodeGeometryPageWasm(donnees.slice(), 1 << 20);
  const enPlace = await decodeGeometryPage(donnees.slice(), 1 << 20);
  assert.deepEqual(Array.from(parWasm.indices), Array.from(enPlace.indices));
  for (const nom of Object.keys(enPlace.attributes)) {
    const a = parWasm.attributes[nom],
      b = enPlace.attributes[nom];
    for (let i = 0; i < b.length; i++) assert.ok(Object.is(a[i], b[i]), `${nom}[${i}]`);
  }
  assert.ok(Object.is(parWasm.attributes.position[0], -0));
});

test('des octets qui ne sont pas un module WebAssembly valide font échouer l’instanciation sans lever', async () => {
  const { decodeGeometryPageWasm, prepareSdkWasm } = await frais();
  assert.equal(await prepareSdkWasm(new Uint8Array([1, 2, 3, 4])), null);
  const donnees = await pageAvecMoinsZero();
  const parRepli = await decodeGeometryPageWasm(donnees.slice(), 1 << 20);
  const enPlace = await decodeGeometryPage(donnees.slice(), 1 << 20);
  assert.deepEqual(Array.from(parRepli.indices), Array.from(enPlace.indices));
});

test('un moteur sans SIMD simulé — l’instanciation qui lève — retombe sur le décodeur JavaScript', async () => {
  const { decodeGeometryPageWasm, prepareSdkWasm } = await frais();
  const original = WebAssembly.instantiate;
  // @ts-expect-error : simule un moteur qui refuse de compiler le module (SIMD absent, par exemple).
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

test('sans WebAssembly du tout, l’instanciation rend null tout de suite', async () => {
  const { prepareSdkWasm } = await frais();
  const original = globalThis.WebAssembly;
  // @ts-expect-error : simule une plateforme sans WebAssembly.
  delete globalThis.WebAssembly;
  try {
    assert.equal(await prepareSdkWasm(MODULE), null);
  } finally {
    globalThis.WebAssembly = original;
  }
});

test('même chargé, le module refuse une page trop courte avant d’y toucher', async () => {
  const { decodeGeometryPageWasm, prepareSdkWasm } = await frais();
  assert.ok(await prepareSdkWasm(MODULE));
  await assert.rejects(
    () => decodeGeometryPageWasm(new Uint8Array(10), 1 << 20),
    /GEOMETRY_PAGE_HEADER/,
  );
});
