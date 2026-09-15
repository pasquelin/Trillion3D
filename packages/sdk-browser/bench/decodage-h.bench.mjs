// Lot H2 : le décodage d'une page hors du fil principal. Ce que Node peut prouver et ce qu'il ne peut
// pas : `worker_threads` n'est pas le navigateur — il n'a ni `Worker` de module, ni fil de rendu, ni
// image à ne pas manquer. Donc ici, deux choses seulement, et elles suffisent à la règle du dépôt :
//   1. le décodage pur, chronométré des deux côtés du contrat ;
//   2. l'égalité `Object.is` octet par octet entre le chemin de repli (sur le fil) et le chemin
//      décodé (tampons transférés par un vrai worker, puis reconstruits).
// Ce qui ne se mesure qu'en navigateur : le temps rendu au fil principal entre deux images, donc
// `cpuFrameMs` et la régularité des images. Node exécute ici le repli synchrone — `Worker` n'y
// existe pas — si bien que les colonnes « Avant » et « Après » y mesurent le prix du contrat
// (une copie de la page compressée, l'aller-retour des messages), jamais son gain.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { PAGE_DECODE_PROTOCOL } from '../../sdk-core/index.ts';
import { prepareGeometryPageWasm } from '../geometryPageWasm.ts';
import { RACINE, compare, graine, verifieEtDepose } from '../../sdk-core/bench/banc.mjs';
import { encodeGeometryPage } from '../../page-codec/geometryPage.mjs';
import { decodeGeometryPage } from '../geometryPage.ts';
import { decodePageOffThread, verifyPageBytes } from '../pageDecodeHost.ts';
import { restorePageDecode } from '../pageDecodeTask.ts';
import { sha256Hex } from '../sha256Hex.ts';

const MAX_DECODED_BYTES = 16 * 1024 * 1024;
const alea = graine(211);

// Node ne suit pas une URL de fichier avec `fetch` : l'hôte fournit les octets, comme le prévoit le
// chargeur. Sans cela le banc comparerait le décodeur JavaScript à lui-même, et ne dirait rien du
// chemin réellement livré, qui passe par le module WebAssembly dès qu'il s'instancie.
const MODULE = readFileSync(join(RACINE, 'packages', 'sdk-browser', 'pageCodec.wasm'));
if (!(await prepareGeometryPageWasm(MODULE)))
  throw new Error('H2_WASM_ABSENT : lancer `npm run build:wasm`');

/** Une page complète : les six attributs, donc le pas de 72 octets qu'exige le décodeur. */
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

/** Un vrai worker, qui exécute la tâche partagée et rend ses tampons transférés. */
const dossier = mkdtempSync(join(tmpdir(), 'wg-decodage-h-'));
const tache = join(dossier, 'tache.mjs');
writeFileSync(
  tache,
  `import { readFileSync } from 'node:fs';\n` +
    `import { parentPort } from 'node:worker_threads';\n` +
    `import { runPageDecodeTask } from ${JSON.stringify(
      new URL('../pageDecodeTask.ts', import.meta.url).href,
    )};\n` +
    `import { prepareGeometryPageWasm } from ${JSON.stringify(
      new URL('../geometryPageWasm.ts', import.meta.url).href,
    )};\n` +
    `await prepareGeometryPageWasm(readFileSync(${JSON.stringify(
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

/** Premier écart bit à bit entre deux pages décodées, ou `null`. */
function ecartPage(a, b) {
  const cles = Object.keys(a.attributes),
    autres = Object.keys(b.attributes);
  if (cles.join(',') !== autres.join(',')) return `attributs ${cles} ≠ ${autres}`;
  for (const cle of ['vertexCount', 'flags', 'decodedBytes'])
    if (!Object.is(a[cle], b[cle])) return `${cle}: ${a[cle]} ≠ ${b[cle]}`;
  if (a.indices.length !== b.indices.length) return 'longueur des indices';
  for (let i = 0; i < a.indices.length; i++)
    if (!Object.is(a.indices[i], b.indices[i])) return `indices[${i}]`;
  for (const cle of cles) {
    const x = a.attributes[cle],
      y = b.attributes[cle];
    if (x.constructor !== y.constructor || x.length !== y.length) return `${cle}: forme`;
    for (let i = 0; i < x.length; i++) if (!Object.is(x[i], y[i])) return `${cle}[${i}]`;
  }
  return null;
}

test('H2 : le worker rend exactement les octets du fil principal, page et empreinte', async () => {
  const surPlace = await decodeGeometryPage(grande, MAX_DECODED_BYTES);
  const decodee = await horsFil('decode', grande.slice().buffer);
  assert.equal(decodee.ok, true, decodee.message);
  assert.equal(ecartPage(surPlace, restorePageDecode(decodee.decoded)), null);

  const attendu = await sha256Hex(grande.slice().buffer);
  const verifiee = await horsFil('verify', grande.slice().buffer);
  assert.equal(verifiee.ok, true, verifiee.message);
  assert.equal(verifiee.sha256, attendu);
  const rendus = new Uint8Array(verifiee.source);
  assert.equal(rendus.length, grande.length);
  for (let i = 0; i < grande.length; i++) assert.ok(Object.is(rendus[i], grande[i]), `octet ${i}`);
  await worker.terminate();
});

const lignes = [
  await compare({
    calcul: 'H1 décodage de page par le contrat, module WebAssembly actif',
    fichier: 'packages/sdk-browser/pageDecodeHost.ts',
    cas: [
      { nom: '30 000 sommets, six attributs', entree: grande, taille: 30000 },
      { nom: '9 sommets', entree: petite, taille: 9 },
    ],
    reference: (data) => decodeGeometryPage(data, MAX_DECODED_BYTES),
    optimisee: (data) => decodePageOffThread(data),
    options: { tours: 40, budgetMs: 2000, alterne: true },
  }),
  await compare({
    calcul: 'H2 hachage d’intégrité par le contrat',
    fichier: 'packages/sdk-browser/pageDecodeHost.ts',
    cas: [
      { nom: '30 000 sommets, page compressée', entree: grande.buffer, taille: grande.byteLength },
      { nom: '9 sommets', entree: petite.buffer, taille: petite.byteLength },
    ],
    reference: (source) => sha256Hex(source),
    optimisee: async (source) => (await verifyPageBytes(source)).sha256,
    options: { tours: 200, budgetMs: 2000, alterne: true },
  }),
];

// « Retenu » veut dire ici « livré », et non « plus rapide sous Node » : le gain de ce lot est du
// temps rendu au fil principal du navigateur, que ce banc ne peut pas voir. Ce qui décide, c'est
// l'égalité bit à bit — sans elle, la ligne tombe.
const livrees = lignes.map((ligne) => ({ ...ligne, retenu: ligne.identique }));

verifieEtDepose(
  'decodage-h',
  'H1 et H2 rendent exactement les mêmes valeurs',
  livrees,
  join(RACINE, '.mesure', 'calculs-h2'),
);
