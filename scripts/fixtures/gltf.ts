// The one glTF buffer packer: flat attribute and index arrays packed into views and accessors, for
// every scene the scripts and the bench write as glTF — the committed fixtures and the generated
// bench scenes alike.

interface BufferView {
  buffer: number
  byteOffset: number
  byteLength: number
  target?: number
}

interface Accessor {
  bufferView: number
  componentType: number
  count: number
  type: string
  min?: number[]
  max?: number[]
}

/** Bounds of flat `values` of `size` components, as an accessor of a vertex attribute names them:
 *  read from the stored values, so they are the very numbers the accessor holds. */
function bounds(values: ArrayLike<number>, size: number) {
  const min: number[] = Array(size).fill(Infinity),
    max: number[] = Array(size).fill(-Infinity)
  for (let index = 0; index < values.length; index++) {
    min[index % size] = Math.min(min[index % size], values[index])
    max[index % size] = Math.max(max[index % size], values[index])
  }
  return { min, max }
}

/** `values` as stored: 32-bit unsigned indices, or 32-bit floats; an array already of that type is
 *  stored as it is, not copied. */
function stored(values: ArrayLike<number>, indices: boolean): Uint32Array | Float32Array {
  if (indices) return values instanceof Uint32Array ? values : Uint32Array.from(values)
  return values instanceof Float32Array ? values : Float32Array.from(values)
}

/**
 * Packs flat attribute and index arrays into one binary chunk list: the views and accessors of
 * buffer `buffer`, numbered from `firstView` and `firstAccessor`. A `size` of 1 is an index list;
 * every value is four bytes, so each view starts aligned. A vertex attribute names its bounds; an
 * `instanced` accessor — a node's per-instance translations, rotations or scales
 * (`EXT_mesh_gpu_instancing`) — names no vertex target nor bounds.
 */
export function bufferPacker(buffer: number, firstView = 0, firstAccessor = 0) {
  const views: BufferView[] = [],
    accessors: Accessor[] = [],
    chunks: Buffer[] = []
  let byteLength = 0
  const accessor = (values: ArrayLike<number>, size: number, instanced = false): number => {
    const indices = size === 1,
      data = stored(values, indices)
    const view: BufferView = { buffer, byteOffset: byteLength, byteLength: data.byteLength }
    if (!instanced) view.target = indices ? 34963 : 34962
    views.push(view)
    chunks.push(Buffer.from(data.buffer, data.byteOffset, data.byteLength))
    byteLength += data.byteLength
    const entry: Accessor = {
      bufferView: firstView + views.length - 1,
      componentType: indices ? 5125 : 5126,
      count: data.length / size,
      type: indices ? 'SCALAR' : `VEC${size}`,
    }
    if (!indices && !instanced) {
      const { min, max } = bounds(data, size)
      entry.min = min
      entry.max = max
    }
    accessors.push(entry)
    return firstAccessor + accessors.length - 1
  }
  return { views, accessors, chunks, accessor, byteLength: () => byteLength }
}
