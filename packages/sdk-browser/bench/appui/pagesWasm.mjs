// Pages of the H2b bench. They come out of the reference encoder `packages/page-codec`, the
// same one that serves as oracle to the JavaScript decoder: what the bench compares is thus
// two reads of a real page, not two reads of a buffer made for the occasion.
import { encodeGeometryPage } from '../../../page-codec/geometryPage.mjs';
import { graine } from '../../../sdk-core/bench/socle.mjs';

const alea = graine(20260915);

/** Finite but hostile floats: signed zero, denormals, and noise within `±amplitude / 2`. */
function hostiles(n, amplitude) {
  const output = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const tirage = Math.floor(alea() * 8);
    if (tirage === 0) output[i] = 0;
    else if (tirage === 1) output[i] = -0;
    else if (tirage === 2) output[i] = 1.175494e-38;
    else if (tirage === 3) output[i] = -7e-45;
    else output[i] = (alea() - 0.5) * amplitude;
  }
  return output;
}

/** Width and amplitude of each optional attribute: texture coordinates stay within the 2^24
 *  cells the format grants a page on its 2^-14 grid, as positions do on the 2^-6 grid below. */
const LARGEURS = [
  ['NORMAL', 3, 2],
  ['TEXCOORD_0', 2, 512],
  ['TEXCOORD_1', 2, 512],
  ['COLOR_0', 3, 2],
];

/** A page of `sommets` vertices, with or without its four optional attributes. */
export function page(sommets, tousLesAttributs) {
  const attributes = { POSITION: { itemSize: 3, array: hostiles(sommets * 3, 2048) } };
  if (tousLesAttributs)
    for (const [name, largeur, amplitude] of LARGEURS)
      attributes[name] = { itemSize: largeur, array: hostiles(sommets * largeur, amplitude) };
  const indices = new Uint32Array(sommets * 3);
  for (let i = 0; i < sommets; i++) {
    indices[i * 3] = i;
    indices[i * 3 + 1] = (i + 1) % sommets;
    indices[i * 3 + 2] = (i + 2) % sommets;
  }
  return encodeGeometryPage(indices, attributes, -6).data;
}

/**
 * A page the encoder would never write: a triangle of three distinct vertices whose index
 * stream is overwritten with `locaux` (two bits per index), to slip in an index out of bounds.
 * Both decoders must reject it for the same reason.
 */
export function pageForgee(locaux) {
  const position = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const data = encodeGeometryPage([0, 1, 2], { POSITION: { itemSize: 3, array: position } }).data;
  new DataView(data.buffer).setUint32(96, locaux[0] | (locaux[1] << 2) | (locaux[2] << 4), true);
  return data;
}
