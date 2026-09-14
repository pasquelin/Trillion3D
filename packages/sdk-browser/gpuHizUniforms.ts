import { hizLevelSizes } from './gpuHizOracle.ts';

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
