import { writeFloatAtlas, type FloatAtlas } from './floatAtlas.ts'

/**
 * A geometry's second UV set read as floats (`vertUv1`, `../../visibility/shader/pageWgsl.ts`): two
 * floats a vertex at the tail of the normal atlas it is read through — the float pool's
 * (`geometryPool.ts`), a transparent primitive's own (`../blend/buffers.ts`) —, vertex `k` at
 * float `T − 2(k + 1)`, `T` the atlas's texels. Counted back from the last texel, the tail needs no
 * count of the atlas's vertices, which only its owner knows: the shader finds it from the texture's
 * size, the normals keep their place at its head, and a pool that grows writes its atlas again,
 * tail included, at the new size. An atlas holds the tail only where a geometry of it has a second
 * set, and a row reads it only where its own geometry does (`PHYSICAL_SECOND_UV`).
 */
export const UV1_FLOATS = 2

/** The atlas's texels: where the tail ends. */
export const atlasTexels = ({ extent }: FloatAtlas) => extent[0] * extent[1] * extent[2]

/** The float the tail of vertices `vertex` to `vertex + n - 1` starts at: the last one's. A writer
 *  that builds the atlas whole puts vertex `k`'s pair at `uv1TailAt(atlas, k, 1)`. */
export const uv1TailAt = (atlas: FloatAtlas, vertex: number, n: number) =>
  atlasTexels(atlas) - UV1_FLOATS * (vertex + n)

/** Writes `n` second-UV pairs of `data`, in vertex order, as the tail of vertices from `vertex`:
 *  their order reversed in place, then sent at `uv1TailAt`. */
export function writeUv1Tail(
  queue: GPUQueue,
  atlas: FloatAtlas,
  vertex: number,
  data: Float32Array<ArrayBuffer>,
  n: number,
) {
  for (let low = 0, high = n - 1; low < high; low++, high--)
    for (let c = 0; c < UV1_FLOATS; c++) {
      const a = low * UV1_FLOATS + c,
        b = high * UV1_FLOATS + c
      const kept = data[a]
      data[a] = data[b]
      data[b] = kept
    }
  writeFloatAtlas(queue, atlas, uv1TailAt(atlas, vertex, n), data, 0, n * UV1_FLOATS)
}
