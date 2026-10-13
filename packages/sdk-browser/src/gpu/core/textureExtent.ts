// A `GPUExtent3D` read as numbers: what a texture's byte count and the test kit's device read.
/** A `GPUExtent3D`, a sequence or a dictionary, as its width, height and depth or layers: the
 *  two last 1 when left out. */
export function textureExtent(size: GPUExtent3D): [number, number, number] {
  if (Array.isArray(size)) return [size[0] ?? 1, size[1] ?? 1, size[2] ?? 1]
  const s = size as GPUExtent3DDict
  return [s.width, s.height ?? 1, s.depthOrArrayLayers ?? 1]
}
