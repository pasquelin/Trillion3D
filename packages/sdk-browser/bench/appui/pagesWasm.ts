// Pages of the H2b bench, of the decoder tests and of the GPU proof. They come out of the
// reference encoder `packages/page-codec`, the same one that serves as oracle to the JavaScript
// decoder: what is compared is thus two reads of a real page, not of a buffer made for the
// occasion.
import { encodeGeometryPage } from '../../../page-codec/geometryPage.ts';
import { graine } from '../../../sdk-core/bench/socle.ts';
import type { OptionalAttributeName, PageAttributes } from '../../../page-codec/pageAttributes.ts';

const alea = graine(20260915);

/** Finite but hostile floats: signed zero, denormals, and noise within `±amplitude / 2`. */
function hostiles(n: number, amplitude: number): Float32Array {
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
const LARGEURS: [OptionalAttributeName, number, number][] = [
  ['NORMAL', 3, 2],
  ['TEXCOORD_0', 2, 512],
  ['TEXCOORD_1', 2, 512],
  ['COLOR_0', 3, 2],
];

/** A page of `sommets` vertices, with or without its four optional attributes. */
export function page(sommets: number, tousLesAttributs: boolean) {
  const attributes: PageAttributes = {
    POSITION: { itemSize: 3, array: hostiles(sommets * 3, 2048) },
  };
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
 * A ring of `triangles` triangles sharing their vertices, every attribute carried, positions off
 * the grid of `exponent`; the colour `colorWidth` wide, three for a source without alpha.
 * Returns the encoded page with the source indices and attributes it came from.
 */
export function anneau(triangles: number, exponent: number, colorWidth = 4) {
  const count = triangles + 2,
    position = new Float32Array(count * 3),
    normal = new Float32Array(count * 3),
    uv = new Float32Array(count * 2),
    uv2 = new Float32Array(count * 2),
    color = new Float32Array(count * colorWidth);
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    position.set([Math.cos(angle) * 2.3 + 100.7, Math.sin(angle) * 2.3 - 40.1, i * 0.0173], i * 3);
    normal.set([Math.cos(angle) * 0.6, Math.sin(angle) * 0.6, i % 2 ? 0.8 : -0.8], i * 3);
    uv.set([i / count, 0.5 + Math.sin(angle) * 0.25], i * 2);
    uv2.set([3 + i * 0.01, 7 - i * 0.02], i * 2);
    color.set([i / count, 1 - i / count, 0.5, 1].slice(0, colorWidth), i * colorWidth);
  }
  const indices: number[] = [];
  for (let t = 0; t < triangles; t++) indices.push(t, t + 1, t + 2);
  const attributes: PageAttributes = {
    POSITION: { itemSize: 3, array: position },
    NORMAL: { itemSize: 3, array: normal },
    TEXCOORD_0: { itemSize: 2, array: uv },
    TEXCOORD_1: { itemSize: 2, array: uv2 },
    COLOR_0: { itemSize: colorWidth, array: color },
  };
  return { encoded: encodeGeometryPage(indices, attributes, exponent), indices, attributes };
}

/**
 * A page the encoder would never write: a triangle of three distinct vertices whose index
 * stream is overwritten with `locaux` (two bits per index), to slip in an index out of bounds.
 * Both decoders must reject it for the same reason.
 */
export function pageForgee(locaux: [number, number, number]) {
  const position = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const data = encodeGeometryPage([0, 1, 2], { POSITION: { itemSize: 3, array: position } }).data;
  new DataView(data.buffer).setUint32(96, locaux[0] | (locaux[1] << 2) | (locaux[2] << 4), true);
  return data;
}
