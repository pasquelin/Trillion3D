import type { HostAttributes } from '../../host/resources.ts';

/**
 * Vertex colours of the geometry the WebGPU passes read as floats — a transparent primitive, a
 * cache that carries no geometry page — ride at the tail of the UV buffer every page-geometry pass
 * already binds (raster, compute raster, shadow depth, resolve, transparent draw), not on a
 * binding of their own: `[u v] × n`, then `[rgba] × n`. The tail exists only when a geometry of
 * the buffer has colours, so a scene without any uploads the buffer it always did; the shader
 * finds the tail from the buffer's own length. A quantized page carries its colours itself
 * (`../../cluster/decodeWgsl.ts`).
 */
const UV_FLOATS = 2;
const COLOR_FLOATS = 4;

/** Floats of a UV buffer of `vertices` vertices, with the colour tail when `coloured`. */
export const uvBufferFloats = (vertices: number, coloured: boolean) =>
  vertices * (UV_FLOATS + (coloured ? COLOR_FLOATS : 0));

/** Writes up to `count` colours of `color` at vertex `base` of the tail of a buffer of `vertices`
 *  vertices; a three-component colour takes an alpha of one, as the forward path reads it. */
export function writeVertexColors(
  into: Float32Array,
  vertices: number,
  base: number,
  count: number,
  color: HostAttributes[string],
) {
  const tail = vertices * UV_FLOATS;
  for (let i = 0; i < Math.min(count, color.count); i++)
    for (let c = 0; c < COLOR_FLOATS; c++)
      into[tail + (base + i) * COLOR_FLOATS + c] =
        c < color.itemSize ? color.getComponent(i, c) : 1;
}

/** Colour of source vertex `id`, read in the tail of the `uvs` buffer the host declares.
 *  Called only where the row or the item says its geometry has colours, hence a tail. */
export const VERTEX_COLOR_WGSL = `fn vertColor(id:u32)->vec4f{
 let i=arrayLength(&uvs)/${UV_FLOATS + COLOR_FLOATS}u*${UV_FLOATS}u+id*${COLOR_FLOATS}u;
 return vec4f(uvs[i],uvs[i+1u],uvs[i+2u],uvs[i+3u]);
}`;
