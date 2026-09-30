/** Native 4 × 4 block layouts: required WebGPU feature and bytes in one block. */
const FORMATS: Record<string, [GPUFeatureName, number]> = {
  'bc1-rgba-unorm': ['texture-compression-bc', 8],
  'bc2-rgba-unorm': ['texture-compression-bc', 16],
  'bc3-rgba-unorm': ['texture-compression-bc', 16],
  'bc4-r-unorm': ['texture-compression-bc', 8],
  'bc5-rg-unorm': ['texture-compression-bc', 16],
  'bc7-rgba-unorm': ['texture-compression-bc', 16],
  'etc2-rgb8unorm': ['texture-compression-etc2', 8],
  'etc2-rgb8a1unorm': ['texture-compression-etc2', 8],
  'etc2-rgba8unorm': ['texture-compression-etc2', 16],
  'eac-r11unorm': ['texture-compression-etc2', 8],
  'eac-rg11unorm': ['texture-compression-etc2', 16],
  'astc-4x4-unorm': ['texture-compression-astc', 16],
};

/** Both transfer variants have the same block geometry and capability requirement. */
export const compressedBlockInfo = (format: string) => FORMATS[format.replace(/-srgb$/, '')];
