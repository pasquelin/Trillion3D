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

/**
 * Every level's source and destination are a function of the target size alone, so the whole uniform
 * array is written once per allocation and no image uploads a byte to build the pyramid. Slot 0 holds
 * the level-0 size; slot i+1 the offsets and sizes the reduction of level i reads and writes. Every
 * slot's seventh word is `stride`, the words between two pyramids built in one dispatch — zero for
 * the camera's single pyramid (`shader.ts`).
 */
export function writeHizLevelUniforms(
  device: GPUDevice,
  uniforms: GPUBuffer,
  levelWords: Uint32Array<ArrayBuffer>,
  sizes: Array<[number, number]>,
  offsets: number[],
  width: number,
  height: number,
  maxLevels: number,
  uniformBytes: number,
  stride = 0,
) {
  levelWords.fill(0);
  levelWords[0] = width;
  levelWords[1] = height;
  levelWords[6] = stride;
  for (let i = 0; i < sizes.length - 1 && i + 1 < maxLevels; i++) {
    const [srcW, srcH] = sizes[i],
      [dstW, dstH] = sizes[i + 1],
      base = (i + 1) * (uniformBytes / 4);
    levelWords[base] = offsets[i];
    levelWords[base + 1] = srcW;
    levelWords[base + 2] = srcH;
    levelWords[base + 3] = offsets[i + 1];
    levelWords[base + 4] = dstW;
    levelWords[base + 5] = dstH;
    levelWords[base + 6] = stride;
  }
  device.queue.writeBuffer(uniforms, 0, levelWords);
}
