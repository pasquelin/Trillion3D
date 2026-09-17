// décodage hors du fil principal et hachage d'intégrité.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { PAGE_DECODE_PROTOCOL } from '../../sdk-core/index.ts';
import { prepareSdkWasm } from '../geometryPageWasm.ts';
import { RACINE, ecart, graine, mesure, stress, rapport } from '../../sdk-core/bench/socle.mjs';
import { encodeGeometryPage } from '../../page-codec/geometryPage.mjs';
import { decodeGeometryPage } from '../geometryPage.ts';
import { decodePageOffThread, verifyPageBytes } from '../pageDecodeHost.ts';
import { restorePageDecode } from '../pageDecodeTask.ts';
import { sha256Hex } from '../sha256Hex.ts';

const MAX_DECODED_BYTES = 16 * 1024 * 1024;
const alea = graine(211);
const MODULE = readFileSync(join(RACINE, 'packages', 'sdk-browser', 'pageCodec.wasm'));
if (!(await prepareSdkWasm(MODULE)))
  throw new Error('H2_WASM_ABSENT : lancer `pnpm run build:wasm`');

async function page(sommets) {
  const position = new Float32Array(sommets * 3),
    normal = new Float32Array(sommets * 3),
    uv = new Float32Array(sommets * 2),
    uv2 = new Float32Array(sommets * 2),
    tangent = new Float32Array(sommets * 4),
    color = new Float32Array(sommets * 4);
  for (let i = 0; i < sommets; i++) {
    position.set([alea() * 4 - 2, alea() * 4 - 2, alea() * 4 - 2], i * 3);
    normal.set([0, 1, 0], i * 3);
    uv.set([alea(), alea()], i * 2);
    uv2.set([alea(), alea()], i * 2);
    tangent.set([1, 0, 0, 1], i * 4);
    color.set([alea(), alea(), alea(), 1], i * 4);
  }
  const triangles = Math.floor(sommets / 3) * 3,
    indices = new Uint32Array(triangles);
  for (let i = 0; i < triangles; i++) indices[i] = (i * 7919) % sommets;
  const encodee = await encodeGeometryPage(indices, {
    POSITION: { itemSize: 3, array: position },
    NORMAL: { itemSize: 3, array: normal },
    TEXCOORD_0: { itemSize: 2, array: uv },
    TEXCOORD_1: { itemSize: 2, array: uv2 },
    TANGENT: { itemSize: 4, array: tangent },
    COLOR_0: { itemSize: 4, array: color },
  });
  return encodee.data;
}

const grande = await page(30000),
  petite = await page(9);

const dossier = mkdtempSync(join(tmpdir(), 'decodage-h-'));
const tache = join(dossier, 'tache.mjs');
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

test('H2 : le worker rend exactement la page et les octets du fil principal', async () => {
  const surPlace = await decodeGeometryPage(grande, MAX_DECODED_BYTES);
  const decodee = await horsFil('decode', grande.slice().buffer);
  assert.equal(decodee.ok, true, decodee.message);
  assert.equal(ecart(surPlace, restorePageDecode(decodee.decoded), 'page'), null);

  const attendu = await sha256Hex(grande.slice().buffer);
  const verifiee = await horsFil('verify', grande.slice().buffer);
  assert.equal(verifiee.ok, true, verifiee.message);
  assert.equal(verifiee.sha256, attendu);
  const rendus = new Uint8Array(verifiee.source);
  assert.equal(rendus.length, grande.length);
  for (let i = 0; i < grande.length; i++) assert.ok(Object.is(rendus[i], grande[i]), `octet ${i}`);
  await worker.terminate();
});

const resDecode = await mesure({
  nom: 'décodage contrat WebAssembly',
  fichier: 'packages/sdk-browser/pageDecodeHost.ts',
  cas: [
    { nom: '30 000 sommets, 6 attributs', entree: grande, taille: 30000 },
    { nom: '9 sommets', entree: petite, taille: 9 },
  ],
  calcul: (data) => decodePageOffThread(data),
  attendu: (data) => decodeGeometryPage(data, MAX_DECODED_BYTES),
  options: { tours: 20, budgetMs: 1500 },
});

const resHash = await mesure({
  nom: 'hachage intégrité contrat',
  fichier: 'packages/sdk-browser/pageDecodeHost.ts',
  cas: [
    { nom: '30 000 sommets, compressée', entree: grande.buffer, taille: grande.byteLength },
    { nom: '9 sommets', entree: petite.buffer, taille: petite.byteLength },
  ],
  calcul: async (source) => (await verifyPageBytes(source)).sha256,
  attendu: (source) => sha256Hex(source),
  options: { tours: 40, budgetMs: 1500 },
});

await stress({
  nom: 'verifyPageBytes extremes',
  calcul: (buf) => verifyPageBytes(buf),
  extremes: [{ nom: 'tampon vide', entree: new ArrayBuffer(0) }],
});

rapport('decodage-worker', [resDecode, resHash], 'H1 et H2 rendent exactement les mêmes valeurs');
