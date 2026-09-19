// Pages of the H2b bench. They come out of the reference encoder `packages/page-codec`, the
// same one that serves as oracle to the JavaScript decoder: what the bench compares is thus
// two reads of a real page, not two reads of a buffer made for the occasion.
import * as meshoptimizer from 'meshoptimizer';
import { encodeGeometryPage } from '../../../page-codec/geometryPage.mjs';
import { graine } from '../../../sdk-core/bench/socle.mjs';

const STRIDE = 72;
const alea = graine(20260915);

/** Finite but hostile floats: signed zero, denormals, extremes, and noise in between. */
function hostiles(n) {
  const output = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const tirage = Math.floor(alea() * 8);
    if (tirage === 0) output[i] = 0;
    else if (tirage === 1) output[i] = -0;
    else if (tirage === 2) output[i] = 1.175494e-38;
    else if (tirage === 3) output[i] = -7e-45;
    else if (tirage === 4) output[i] = 3.4028234e38;
    else if (tirage === 5) output[i] = -3.4028234e38;
    else output[i] = (alea() - 0.5) * 2048;
  }
  return output;
}

const LARGEURS = [
  ['NORMAL', 3],
  ['TEXCOORD_0', 2],
  ['TANGENT', 4],
  ['TEXCOORD_1', 2],
  ['COLOR_0', 3],
];

/** A page of `sommets` vertices, with or without its five optional attributes. */
export async function page(sommets, tousLesAttributs) {
  const attributes = { POSITION: { itemSize: 3, array: hostiles(sommets * 3) } };
  if (tousLesAttributs)
    for (const [name, largeur] of LARGEURS)
      attributes[name] = { itemSize: largeur, array: hostiles(sommets * largeur) };
  const indices = new Uint32Array(sommets * 3);
  for (let i = 0; i < sommets; i++) {
    indices[i * 3] = i;
    indices[i * 3 + 1] = (i + 1) % sommets;
    indices[i * 3 + 2] = (i + 2) % sommets;
  }
  const { data } = await encodeGeometryPage(indices, attributes);
  return data;
}

/**
 * A hand-assembled page, to slip in what the encoder refuses to write: an out-of-bounds
 * index, a non-finite float. Both decoders must reject it for the same reason.
 */
export async function pageBrute(sommets, locaux, declare, flags) {
  await meshoptimizer.MeshoptEncoder.ready;
  const locale = new Uint16Array(locaux);
  const index = meshoptimizer.MeshoptEncoder.encodeIndexBuffer(
    new Uint8Array(locale.buffer),
    locale.length,
    2,
  );
  const vertex = meshoptimizer.MeshoptEncoder.encodeVertexBuffer(
    sommets,
    sommets.length / STRIDE,
    STRIDE,
  );
  const data = new Uint8Array(32 + index.length + vertex.length),
    head = new DataView(data.buffer);
  const mots = [0x32504757, 2, declare, locale.length, flags, STRIDE, index.length, vertex.length];
  for (let i = 0; i < mots.length; i++) head.setUint32(i * 4, mots[i], true);
  data.set(index, 32);
  data.set(vertex, 32 + index.length);
  return data;
}

/** Three zero vertices, one of which carries `valeur` in the second float if asked. */
export function sommetsPlats(valeur) {
  const sommets = new Uint8Array(3 * STRIDE);
  if (valeur !== undefined) new DataView(sommets.buffer).setFloat32(STRIDE + 4, valeur, true);
  return sommets;
}
