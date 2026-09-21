// off-main-thread decode and integrity hashing.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { PAGE_DECODE_PROTOCOL } from '../../sdk-core/index.ts';
import { prepareSdkWasm } from '../geometryPageWasm.ts';
import { RACINE, ecart, graine, mesure, stress, rapport } from '../../sdk-core/bench/socle.ts';
import { encodeGeometryPage } from '../../page-codec/geometryPage.ts';
import { decodeGeometryPage } from '../geometryPage.ts';
import { decodePageOffThread, verifyPageBytes } from '../pageDecodeHost.ts';
import { restorePageDecode } from '../pageDecodeTask.ts';
import { sha256Hex } from '../sha256Hex.ts';

const MAX_DECODED_BYTES = 16 * 1024 * 1024;
const alea = graine(211);
const MODULE = readFileSync(join(RACINE, 'packages', 'sdk-browser', 'pageCodec.wasm'));
if (!(await prepareSdkWasm(MODULE))) throw new Error('H2_WASM_ABSENT: run `pnpm run build:wasm`');

async function page(sommets) {
  const position = new Float32Array(sommets * 3),
    normal = new Float32Array(sommets * 3),
    uv = new Float32Array(sommets * 2),
    uv2 = new Float32Array(sommets * 2),
    color = new Float32Array(sommets * 4);
  for (let i = 0; i < sommets; i++) {
    position.set([alea() * 4 - 2, alea() * 4 - 2, alea() * 4 - 2], i * 3);
    normal.set([0, 1, 0], i * 3);
    uv.set([alea(), alea()], i * 2);
    uv2.set([alea(), alea()], i * 2);
    color.set([alea(), alea(), alea(), 1], i * 4);
  }
  const triangles = Math.floor(sommets / 3) * 3,
    indices = new Uint32Array(triangles);
  for (let i = 0; i < triangles; i++) indices[i] = (i * 7919) % sommets;
  const encodee = encodeGeometryPage(indices, {
    POSITION: { itemSize: 3, array: position },
    NORMAL: { itemSize: 3, array: normal },
    TEXCOORD_0: { itemSize: 2, array: uv },
    TEXCOORD_1: { itemSize: 2, array: uv2 },
    COLOR_0: { itemSize: 4, array: color },
  });
  return encodee.data;
}

const grande = await page(30000),
  petite = await page(9);

const dossier = mkdtempSync(join(tmpdir(), 'decodage-h-'));
const tache = join(dossier, 'tache.ts');
writeFileSync(
  tache,
  `import { readFileSync } from 'node:fs';\n` +
    `import { parentPort } from 'node:worker_threads';\n` +
    `import { runPageDecodeTask } from ${JSON.stringify(
      new URL('../pageDecodeTask.ts', import.meta.url).href,
    )};\n` +
    `import { prepareSdkWasm } from ${JSON.stringify(
      new URL('../geometryPageWasm.ts', import.meta.url).href,
    )};\n` +
    `await prepareSdkWasm(readFileSync(${JSON.stringify(
      join(RACINE, 'packages', 'sdk-browser', 'pageCodec.wasm'),
    )}));\n` +
    `parentPort.on('message', async (requete) => {\n` +
    `  const { answer, transfer } = await runPageDecodeTask(requete);\n` +
    `  parentPort.postMessage(answer, transfer);\n` +
    `});\n`,
);
const worker = new Worker(tache);
const horsFil = (op, source) =>
  new Promise((resolve, reject) => {
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.postMessage(
      { protocol: PAGE_DECODE_PROTOCOL, id: 1, op, source, maxDecodedBytes: MAX_DECODED_BYTES },
      [source],
    );
  });

test('H2: the worker yields the exact same page and bytes as the main thread', async () => {
  const surPlace = decodeGeometryPage(grande, MAX_DECODED_BYTES);
  const decodee = await horsFil('decode', grande.slice().buffer);
  assert.equal(decodee.ok, true, decodee.message);
  assert.equal(ecart(surPlace, restorePageDecode(decodee.decoded), 'page'), null);

  const attendu = await sha256Hex(grande.slice().buffer);
  const verifiee = await horsFil('verify', grande.slice().buffer);
  assert.equal(verifiee.ok, true, verifiee.message);
  assert.equal(verifiee.sha256, attendu);
  assert.equal(ecart(grande, new Uint8Array(verifiee.source), 'returned bytes'), null);
  await worker.terminate();
});

const resDecode = await mesure({
  name: 'WebAssembly decode contract',
  fichier: 'packages/sdk-browser/pageDecodeHost.ts',
  cas: [
    { name: '30 000 vertices, 6 attributes', input: grande, size: 30000 },
    { name: '9 vertices', input: petite, size: 9 },
  ],
  calcul: (data) => decodePageOffThread(data),
  attendu: (data) => decodeGeometryPage(data, MAX_DECODED_BYTES),
  options: { tours: 20, budgetMs: 1500 },
});

const resHash = await mesure({
  name: 'integrity-hash contract',
  fichier: 'packages/sdk-browser/pageDecodeHost.ts',
  cas: [
    { name: '30 000 vertices, compressed', input: grande.buffer, size: grande.byteLength },
    { name: '9 vertices', input: petite.buffer, size: petite.byteLength },
  ],
  calcul: async (source) => (await verifyPageBytes(source)).sha256,
  attendu: (source) => sha256Hex(source),
  options: { tours: 40, budgetMs: 1500 },
});

await stress({
  name: 'verifyPageBytes extremes',
  calcul: (buf) => verifyPageBytes(buf),
  extremes: [{ name: 'empty buffer', input: new ArrayBuffer(0) }],
});

rapport('decodage-worker', [resDecode, resHash], 'H1 and H2 yield the exact same values');
