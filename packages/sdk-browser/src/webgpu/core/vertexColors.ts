import type { HostAttributes } from '../../host/resources.ts';

/**
 * Vertex colours of the geometry the WebGPU passes read as floats — a transparent primitive, a
 * cache that carries no geometry page — ride at the tail of the normal buffer the resolve and the
 * transparent draw already bind, not on a binding of their own: `[normal xyz, tangent xyzw] × n`,
 * then `[rgba] × n`. The tail exists only when a geometry of the buffer has colours, so a scene
 * without any uploads the buffer it always did; the shader finds the tail from the buffer's own
 * length. A quantized page carries its colours itself (`../../cluster/decodeWgsl.ts`).
 */
const NORMAL_FLOATS = 7;
const COLOR_FLOATS = 4;

/** Floats of a normal buffer of `vertices` vertices, with the colour tail when `coloured`. */
export const normalBufferFloats = (vertices: number, coloured: boolean) =>
  vertices * (NORMAL_FLOATS + (coloured ? COLOR_FLOATS : 0));

/** Writes up to `count` colours of `color` at vertex `base` of the tail of a buffer of `vertices`
 *  vertices; a three-component colour takes an alpha of one, as the forward path reads it. */
export function writeVertexColors(
  into: Float32Array,
  vertices: number,
  base: number,
  count: number,
  color: HostAttributes[string],
) {
  const tail = vertices * NORMAL_FLOATS;
  for (let i = 0; i < Math.min(count, color.count); i++)
    for (let c = 0; c < COLOR_FLOATS; c++)
      into[tail + (base + i) * COLOR_FLOATS + c] =
        c < color.itemSize ? color.getComponent(i, c) : 1;
}

/** Colour of source vertex `id`, read in the tail of the `normals` buffer the host declares.
 *  Called only where the row or the item says its geometry has colours, hence a tail. */
export const VERTEX_COLOR_WGSL = `fn vertColor(id:u32)->vec4f{
 let i=arrayLength(&normals)/${NORMAL_FLOATS + COLOR_FLOATS}u*${NORMAL_FLOATS}u+id*${COLOR_FLOATS}u;
 return vec4f(normals[i],normals[i+1u],normals[i+2u],normals[i+3u]);
}`;
