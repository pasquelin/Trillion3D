// A13 et A14 : lecture des attributs d'une page décompressée et télémétrie.
import * as meshoptimizer from 'meshoptimizer';
import { frameStatistics } from '../../sdk-core/index.ts';
import { encodeGeometryPage } from '../../page-codec/geometryPage.mjs';
import { decodePageAttributes } from '../geometryPage.ts';
import { EngineProfiler } from '../telemetry.ts';
import { toHex } from '../sha256Hex.ts';
import { graine, mesure, stress, rapport } from '../../sdk-core/bench/mesure.mjs';
import { referenceDecode, referenceHex, referenceIntervals } from './oracles/chargement.mjs';

const alea = graine(83);
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

const resDecode = await mesure({
  nom: 'A13 decodePageAttributes',
  fichier: 'packages/sdk-browser/geometryPage.ts',
  cas: [
    { nom: '30 000 sommets, 4 attributs', entree: grande, taille: 30000 },
    { nom: '9 sommets', entree: petite, taille: 9 },
  ],
  calcul: (args) => decodePageAttributes(...args),
  attendu: (args) => referenceDecode(...args),
  options: { tours: 60, budgetMs: 1500 },
});

const resTelemetry = await mesure({
  nom: 'A14 intervalles et hexadécimal',
  fichier: 'packages/sdk-browser/telemetry.ts',
  cas: [
    { nom: '2 000 images, 2 000 empreintes', entree: { intervalles, digests }, taille: 2000 },
    { nom: 'aucune image', entree: { intervalles: [], digests: [] }, taille: 0 },
  ],
  calcul: ({ intervalles: valeurs, digests: liste }) => {
    const profil = new EngineProfiler(120);
    let horloge = 0;
    for (const dt of valeurs) profil.record({}, (horloge += dt));
    return { stats: frameStatistics(profil.orderedIntervals()), hex: liste.map(toHex) };
  },
  attendu: ({ intervalles: valeurs, digests: liste }) => ({
    stats: frameStatistics(referenceIntervals(120, valeurs)),
    hex: liste.map(referenceHex),
  }),
  options: { tours: 100, budgetMs: 1500 },
});

await stress({
  nom: 'toHex extremes',
  calcul: toHex,
  extremes: [
    { nom: 'zero bytes', entree: new Uint8Array(0) },
    { nom: 'one byte', entree: new Uint8Array([255]) },
    { nom: 'all zeros', entree: new Uint8Array(32) },
  ],
});

rapport('chargement', [resDecode, resTelemetry], 'A13 et A14 rendent exactement les mêmes valeurs');
