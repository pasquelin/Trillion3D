// The bench's glTF buffers: flat attribute and index arrays packed into views and accessors, for
// the scenes the bench writes as glTF.

interface BufferView {
  buffer: number
  byteOffset: number
  byteLength: number
  target?: number
}

interface Accessor {
  bufferView: number
  componentType: number
  type: string
  count: number
  min?: readonly number[]
  max?: readonly number[]
}

/** Bounds of flat `values` of `size` components, for the accessor a POSITION attribute requires. */
function bounds(values: ArrayLike<number>, size: number) {
  const min: number[] = Array(size).fill(Infinity),
    max: number[] = Array(size).fill(-Infinity)
  for (let index = 0; index < values.length; index++) {
    min[index % size] = Math.min(min[index % size], values[index])
    max[index % size] = Math.max(max[index % size], values[index])
  }
  return { min, max }
}

/**
 * Packs flat attribute and index arrays into one binary chunk list: the views and accessors of
 * buffer `buffer`, numbered from `firstView` and `firstAccessor`. Every value is four bytes, so
 * each view starts aligned. An `instanced` accessor — a node's per-instance translations,
 * rotations or scales (`EXT_mesh_gpu_instancing`) — names no vertex target nor bounds.
 */
export function bufferPacker(buffer: number, firstView = 0, firstAccessor = 0) {
  const views: BufferView[] = [],
    accessors: Accessor[] = [],
    chunks: Buffer[] = []
  let byteLength = 0
  const accessor = (values: ArrayLike<number>, size: number, instanced = false): number => {
    const indices = size === 1,
      data = indices ? Uint32Array.from(values) : Float32Array.from(values)
    views.push({
      buffer,
      byteOffset: byteLength,
      byteLength: data.byteLength,
      ...(instanced ? {} : { target: indices ? 34963 : 34962 }),
    })
    chunks.push(Buffer.from(data.buffer))
    byteLength += data.byteLength
    accessors.push({
      bufferView: firstView + views.length - 1,
      componentType: indices ? 5125 : 5126,
      type: indices ? 'SCALAR' : `VEC${size}`,
      count: values.length / size,
      ...(indices || instanced ? {} : bounds(values, size)),
    })
    return firstAccessor + accessors.length - 1
  }
  return { views, accessors, chunks, accessor, byteLength: () => byteLength }
}
