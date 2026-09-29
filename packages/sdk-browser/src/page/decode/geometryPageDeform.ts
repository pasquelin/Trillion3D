import {
  CLUSTER_HEADER_WORDS,
  FLAG_MORPH,
  FLAG_SKIN,
  MAX_JOINT_BITS,
  MAX_MORPH_TARGETS,
  MORPH_WORDS,
  WEIGHT_BITS,
  WEIGHT_SCALE,
} from '../../cluster/format.ts';
import { field, record, type Quant } from './geometryPageHeader.ts';

/**
 * What a `WGP3` page carries for the GPU deformation stage (#357), the mirror of the shared
 * codec's `deform.rs`: word 23, the skin record — the page's smallest joint and the width of each
 * joint's distance to it — and the morph target count, then each target's nine words after the
 * header — the word its streams start at, then its position and normal records.
 */
export type PageSkin = { base: number; bits: number };
export type PageMorph = { start: number; position: Quant; normal: Quant };

/** The skin and morph records of a page whose flags are `flags`, read from `head`; a word set
 *  that the flags do not announce, a record outside the format or past the bytes refuses it. */
export function readDeformation(head: DataView, flags: number) {
  const w = (i: number) => head.getUint32(i * 4, true),
    f = (i: number) => head.getFloat32(i * 4, true);
  // Word 23: the joint width in bits 0 to 5, the target count in 6 to 13, the smallest joint in
  // 14 to 29 (`deform.rs`, `word`).
  const word = w(23),
    skin: PageSkin = { bits: word & 63, base: (word >>> 14) & 0xffff },
    count = (word >>> 6) & 255;
  const sane =
    (skin.bits | (count << 6) | (skin.base << 14)) >>> 0 === word &&
    (!!(flags & FLAG_SKIN) || (!skin.bits && !skin.base)) &&
    skin.bits <= MAX_JOINT_BITS &&
    skin.base + 2 ** skin.bits - 1 <= 0xffff &&
    !!(flags & FLAG_MORPH) === count > 0 &&
    count <= MAX_MORPH_TARGETS;
  if (!sane) throw new Error('GEOMETRY_PAGE_BOUNDS');
  if (head.byteLength < (CLUSTER_HEADER_WORDS + count * MORPH_WORDS) * 4)
    throw new Error('GEOMETRY_PAGE_BOUNDS');
  const morphs: PageMorph[] = [];
  for (let t = 0; t < count; t++) {
    const at = CLUSTER_HEADER_WORDS + t * MORPH_WORDS,
      position = record(w(at + 1), [f(at + 2), f(at + 3), f(at + 4)]),
      normal = record(w(at + 5), [f(at + 6), f(at + 7), f(at + 8)]);
    if (!position || !normal) throw new Error('GEOMETRY_PAGE_BOUNDS');
    morphs.push({ start: w(at), position, normal });
  }
  return { skin, morphs };
}

/** Words of `count` fields of `bits` bits. */
const words = (count: number, bits: number) => Math.ceil((count * bits) / 32);

/** Words of the skin's seven streams — four joints, three weights — and of one target's six. */
export const skinWords = (skin: PageSkin, n: number) =>
  4 * words(n, skin.bits) + 3 * words(n, WEIGHT_BITS);
export const morphWords = (morph: PageMorph, n: number) =>
  [...morph.position.bits, ...morph.normal.bits].reduce((sum, b) => sum + words(n, b), 0);

/** Each vertex's four joints, then its four weights, from the skin's streams at word `start`. */
export function decodeSkin(
  body: Uint32Array,
  start: number,
  skin: PageSkin,
  joints: Float32Array,
  weights: Float32Array,
) {
  const n = joints.length / 4,
    jointWords = words(n, skin.bits),
    weightStart = start + 4 * jointWords,
    weightWords = words(n, WEIGHT_BITS);
  for (let v = 0; v < n; v++) {
    for (let j = 0; j < 4; j++)
      joints[v * 4 + j] =
        skin.base + field(body, (start + j * jointWords) * 32 + v * skin.bits, skin.bits);
    let sum = 0;
    for (let j = 0; j < 3; j++) {
      const stored = field(
        body,
        (weightStart + j * weightWords) * 32 + v * WEIGHT_BITS,
        WEIGHT_BITS,
      );
      sum += stored;
      weights[v * 4 + j] = Math.fround(stored / WEIGHT_SCALE);
    }
    weights[v * 4 + 3] = Math.fround(
      Math.max(0, WEIGHT_SCALE - Math.min(WEIGHT_SCALE, sum)) / WEIGHT_SCALE,
    );
  }
}

/** Every target's displacement, six floats a target per vertex — position then normal. */
export function decodeMorphs(body: Uint32Array, morphs: readonly PageMorph[], out: Float32Array) {
  const width = 6 * morphs.length,
    n = out.length / width;
  morphs.forEach((morph, t) => {
    let at = morph.start;
    for (let c = 0; c < 6; c++) {
      const quant = c < 3 ? morph.position : morph.normal,
        bits = quant.bits[c % 3],
        min = quant.min[c % 3],
        step = 2 ** quant.exponent;
      for (let v = 0; v < n; v++)
        out[v * width + t * 6 + c] = Math.fround(
          min + Math.fround(field(body, at * 32 + v * bits, bits) * step),
        );
      at += words(n, bits);
    }
  });
}
