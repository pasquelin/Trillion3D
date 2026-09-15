// A13 et A14 : la lecture des attributs d'une page décompressée, le tampon d'intervalles et le
// passage en hexadécimal. Référence = `geometryPage.ts:63-88`, `telemetry.ts:24-33` et le `digest`
// recopié à l'identique dans `clusterPages.ts` et `streamingFetch.ts`, d'avant le lot A.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as meshoptimizer from 'meshoptimizer';
import { frameStatistics } from '../../../packages/sdk-core/index.ts';
import { encodeGeometryPage } from '../../../packages/page-codec/geometryPage.mjs';
import { decodePageAttributes } from '../../../packages/sdk-browser/geometryPage.ts';
import { EngineProfiler } from '../../../packages/sdk-browser/telemetry.ts';
import { toHex } from '../../../packages/sdk-browser/sha256Hex.ts';
import { compare, depose, graine } from './banc.mjs';

const OPTIONAL = [
  ['normal', 3, 1],
  ['uv', 2, 2],
  ['tangent', 4, 4],
  ['uv2', 2, 8],
  ['color', 4, 16],
];

/** `geometryPage.ts:63-88` avant le lot A : `DataView` élément par élément, fermeture par sommet. */
function referenceDecode(indexData, vertexData, indexCount, vertexCount, flags, stride) {
  const indexView = new DataView(indexData.buffer),
    indices = new Uint32Array(indexCount);
  for (let i = 0; i < indexCount; i++) {
    indices[i] = indexView.getUint16(i * 2, true);
    if (indices[i] >= vertexCount) throw new Error('GEOMETRY_PAGE_INDEX');
  }
  const attributes = { position: new Float32Array(vertexCount * 3) };
  for (const [name, size, bit] of OPTIONAL)
    if (flags & bit) attributes[name] = new Float32Array(vertexCount * size);
  const vertices = new DataView(vertexData.buffer);
  for (let i = 0; i < vertexCount; i++) {
    let offset = i * stride;
    const read = (name, size) => {
      const target = attributes[name];
      for (let c = 0; c < size; c++) {
        const value = vertices.getFloat32(offset, true);
        if (!Number.isFinite(value)) throw new Error('GEOMETRY_PAGE_NONFINITE');
        target[i * size + c] = value;
        offset += 4;
      }
    };
    read('position', 3);
    for (const [name, size, bit] of OPTIONAL)
      if (flags & bit) read(name, size);
      else offset += size * 4;
  }
  return { indices, attributes };
}

/** `telemetry.ts:24-33` avant le lot A : `push` puis `shift` de tout le tableau. */
function referenceIntervals(max, valeurs) {
  const intervals = [];
  for (const dt of valeurs)
    if (dt > 0 && dt < 1000) {
      intervals.push(dt);
      if (intervals.length > max) intervals.shift();
    }
  return intervals;
}

/** `clusterPages.ts:12-15` et `streamingFetch.ts:4-7` avant le lot A : un `toString` par octet. */
const referenceHex = (digested) =>
  Array.from(digested, (b) => b.toString(16).padStart(2, '0')).join('');

const alea = graine(83);
/** Une page compressée, puis décompressée par meshopt : ce que la lecture d'attributs reçoit. */
async function page(sommets) {
  const position = new Float32Array(sommets * 3),
    normal = new Float32Array(sommets * 3),
    uv = new Float32Array(sommets * 2),
    tangent = new Float32Array(sommets * 4);
  for (let i = 0; i < sommets; i++) {
    position.set([alea() * 4 - 2, alea() * 4 - 2, alea() * 4 - 2], i * 3);
    normal.set([0, 1, 0], i * 3);
    uv.set([alea(), alea()], i * 2);
    tangent.set([1, 0, 0, 1], i * 4);
  }
  const triangles = Math.floor(sommets / 3) * 3,
    indices = new Uint32Array(triangles);
  for (let i = 0; i < triangles; i++) indices[i] = (i * 7919) % sommets;
  const encodee = await encodeGeometryPage(indices, {
    POSITION: { itemSize: 3, array: position },
    NORMAL: { itemSize: 3, array: normal },
    TEXCOORD_0: { itemSize: 2, array: uv },
    TANGENT: { itemSize: 4, array: tangent },
  });
  const head = new DataView(encodee.data.buffer, encodee.data.byteOffset, 32),
    stride = 72;
  const indexBytes = head.getUint32(24, true);
  await meshoptimizer.MeshoptDecoder.ready;
  const indexData = new Uint8Array(encodee.indexCount * 2),
    vertexData = new Uint8Array(encodee.vertexCount * stride);
  meshoptimizer.MeshoptDecoder.decodeIndexBuffer(
    indexData,
    encodee.indexCount,
    2,
    encodee.data.subarray(32, 32 + indexBytes),
  );
  meshoptimizer.MeshoptDecoder.decodeVertexBuffer(
    vertexData,
    encodee.vertexCount,
    stride,
    encodee.data.subarray(32 + indexBytes),
  );
  return [indexData, vertexData, encodee.indexCount, encodee.vertexCount, encodee.flags, stride];
}
const grande = await page(30000),
  petite = await page(9);

const intervalles = [];
for (let i = 0; i < 2000; i++) intervalles.push(8 + alea() * 12);
const digests = [];
for (let i = 0; i < 2000; i++) {
  const octets = new Uint8Array(32);
  for (let j = 0; j < 32; j++) octets[j] = Math.floor(alea() * 256);
  digests.push(octets);
}

const lignes = [
  await compare({
    calcul: 'A13 decodePageAttributes',
    fichier: 'packages/sdk-browser/geometryPage.ts',
    cas: [
      { nom: '30 000 sommets, 4 attributs', entree: grande, taille: 30000 },
      { nom: '9 sommets', entree: petite, taille: 9 },
    ],
    reference: (args) => referenceDecode(...args),
    optimisee: (args) => decodePageAttributes(...args),
    options: { tours: 60, budgetMs: 2000 },
  }),
  await compare({
    calcul: 'A14 intervalles et hexadécimal',
    fichier: 'packages/sdk-browser/telemetry.ts',
    cas: [
      { nom: '2 000 images, 2 000 empreintes', entree: { intervalles, digests }, taille: 2000 },
      { nom: 'aucune image', entree: { intervalles: [], digests: [] }, taille: 0 },
    ],
    reference: ({ intervalles: valeurs, digests: liste }) => ({
      stats: frameStatistics(referenceIntervals(120, valeurs)),
      hex: liste.map(referenceHex),
    }),
    optimisee: ({ intervalles: valeurs, digests: liste }) => {
      const profil = new EngineProfiler(120);
      let horloge = 0;
      for (const dt of valeurs) profil.record({}, (horloge += dt));
      return { stats: frameStatistics(profil.orderedIntervals()), hex: liste.map(toHex) };
    },
    options: { tours: 200, budgetMs: 2000 },
  }),
];

test('A13 et A14 rendent exactement les mêmes valeurs', () => {
  for (const ligne of lignes)
    assert.equal(ligne.difference, null, `${ligne.calcul} : ${ligne.difference}`);
});
depose('chargement', lignes);
