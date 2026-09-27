/**
 * The test slot at `byteOffset`: `[width, height, rows, depth bias]`, the rest zero. `words` is the
 * caller's, zeroed at creation and reused every frame; only the first three words ever change, the
 * bias staying +0 (its bits, 0) — no array is allocated per frame.
 */
export function writeHizTestUniforms(
  device: GPUDevice,
  buffer: GPUBuffer,
  words: Uint32Array<ArrayBuffer>,
  byteOffset: number,
  width: number,
  height: number,
  rows: number,
) {
  words[0] = width;
  words[1] = height;
  words[2] = rows;
  device.queue.writeBuffer(buffer, byteOffset, words);
}

/** Bytes of one uniform slot, and the deepest pyramid the camera builds. */
export const HIZ_UNIFORM_BYTES = 256;
export const HIZ_MAX_LEVELS = 16;
/** Mips one build pass reduces in workgroup memory: an 8 × 8 workgroup reduces a 16 × 16 source
 *  tile down to one texel. */
export const HIZ_PASS_LEVELS = 4;
/** Threads per side of a build workgroup: each reduces one 2 × 2 square, and the workgroup
 *  halves them `HIZ_PASS_LEVELS - 1` more times down to one texel. */
export const HIZ_BUILD_SIDE = 1 << (HIZ_PASS_LEVELS - 1);
/** Words of one pass's uniform: the source level, then one `vec4u` per level it writes. */
const PASS_HEADER_WORDS = 8;

/** One build pass: the level it reads, its size, and the count of levels it writes. */
export type HizBuildPass = { source: number; width: number; height: number; levels: number };

/**
 * The build passes of a pyramid of `sizes`, at most `maxLevels` deep: each pass reads one level
 * and reduces the next `HIZ_PASS_LEVELS` from it through workgroup memory. The first reads the
 * level-0 texture, copying it into the pyramid on the way, even when there is nothing to reduce.
 */
export function hizBuildPasses(sizes: Array<[number, number]>, maxLevels = HIZ_MAX_LEVELS) {
  const last = Math.min(sizes.length, maxLevels) - 1;
  const passes: HizBuildPass[] = [];
  let source = 0;
  do {
    const [width, height] = sizes[source];
    passes.push({ source, width, height, levels: Math.min(HIZ_PASS_LEVELS, last - source) });
  } while ((source += HIZ_PASS_LEVELS) < last);
  return passes;
}

/**
 * Every pass's source and destinations are a function of the target size alone, so the whole
 * uniform array is written once per allocation and no image uploads a byte to build the pyramid.
 * Slot `i` holds pass `i`: its source level's offset and size, the count of levels it writes,
 * `stride` — the words between two pyramids built in one dispatch, zero for the camera's single
 * pyramid (`shader.ts`) — then each written level's offset and size. The source at offset zero
 * is level 0, read from the texture.
 */
export function hizBuildWords(
  sizes: Array<[number, number]>,
  offsets: number[],
  passes: HizBuildPass[],
  stride = 0,
) {
  const slot = HIZ_UNIFORM_BYTES / 4,
    words = new Uint32Array(passes.length * slot);
  passes.forEach(({ source, width, height, levels }, i) => {
    words.set([offsets[source], width, height, levels, stride], i * slot);
    for (let k = 0; k < levels; k++) {
      const level = source + 1 + k;
      words.set([offsets[level], ...sizes[level]], i * slot + PASS_HEADER_WORDS + 4 * k);
    }
  });
  return words;
}
