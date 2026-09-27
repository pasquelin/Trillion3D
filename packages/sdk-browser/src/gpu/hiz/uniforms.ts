import { hizLevelSizes } from './oracle.ts';

export function pyramidBytes(width: number, height: number) {
  const sizes = hizLevelSizes(width, height);
  let texels = 0;
  for (const [w, h] of sizes) texels += w * h;
  return { sizes, bytes: Math.max(4, texels * 4) };
}

export function writeUni(
  device: GPUDevice,
  buffer: GPUBuffer,
  packed: Float32Array,
  ints: number[],
  byteOffset = 0,
) {
  packed.fill(0);
  const u32 = new Uint32Array(packed.buffer, packed.byteOffset, packed.length);
  for (let i = 0; i < ints.length; i++) u32[i] = ints[i];
  device.queue.writeBuffer(
    buffer,
    byteOffset,
    packed.buffer as ArrayBuffer,
    packed.byteOffset,
    packed.byteLength,
  );
}

/** Mips one build pass reduces in workgroup memory: an 8 × 8 workgroup reduces a 16 × 16 source
 *  tile down to one texel. */
export const HIZ_PASS_LEVELS = 4;
/** Words of one pass's uniform: the source level, then one `vec4u` per level it writes. */
const PASS_HEADER_WORDS = 8;

export type HizBuildPass = { source: number; levels: number };

/**
 * The build passes of a pyramid of `sizes`, at most `maxLevels` deep: each pass reads one level
 * and reduces the next `HIZ_PASS_LEVELS` from it through workgroup memory. The first reads the
 * level-0 texture, copying it into the pyramid on the way, even when there is nothing to reduce.
 */
export function hizBuildPasses(sizes: Array<[number, number]>, maxLevels: number) {
  const last = Math.min(sizes.length, maxLevels) - 1;
  const passes: HizBuildPass[] = [];
  for (let source = 0; source === 0 || source < last; source += HIZ_PASS_LEVELS)
    passes.push({ source, levels: Math.min(HIZ_PASS_LEVELS, last - source) });
  return passes;
}

/**
 * Every pass's source and destinations are a function of the target size alone, so the whole
 * uniform array is written once per allocation and no image uploads a byte to build the pyramid.
 * Slot `i` holds pass `i`: its source level's offset and size, the count of levels it writes,
 * whether it reads the level-0 texture, `stride` — the words between two pyramids built in one
 * dispatch, zero for the camera's single pyramid (`shader.ts`) — then each written level's
 * offset and size.
 */
export function hizBuildWords(
  words: Uint32Array,
  sizes: Array<[number, number]>,
  offsets: number[],
  passes: HizBuildPass[],
  uniformBytes: number,
  stride = 0,
) {
  words.fill(0);
  passes.forEach(({ source, levels }, i) => {
    const base = i * (uniformBytes / 4),
      [width, height] = sizes[source];
    words.set([offsets[source], width, height, levels, source === 0 ? 1 : 0, 0, stride], base);
    for (let k = 0; k < levels; k++) {
      const level = source + 1 + k;
      words.set([offsets[level], ...sizes[level]], base + PASS_HEADER_WORDS + 4 * k);
    }
  });
  return words;
}

export function writeHizBuildUniforms(
  device: GPUDevice,
  uniforms: GPUBuffer,
  words: Uint32Array<ArrayBuffer>,
  sizes: Array<[number, number]>,
  offsets: number[],
  passes: HizBuildPass[],
  uniformBytes: number,
  stride = 0,
) {
  hizBuildWords(words, sizes, offsets, passes, uniformBytes, stride);
  device.queue.writeBuffer(uniforms, 0, words);
}
