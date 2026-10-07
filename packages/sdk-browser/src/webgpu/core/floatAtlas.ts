import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { GUARANTEED_SIDE, textureLimits } from '../../gpu/core/textureLimits.ts'

/**
 * THE FLOAT ATLAS: a list of floats the passes read by index, kept in an `r32float`
 * texture instead of a storage buffer — the float pool's normals and tangents. A texture is no
 * storage buffer, so the passes that read it (the lighting with bounce, the shadow demand) hold
 * the eight storage buffers WebGPU guarantees per stage; and it is bounded by the texture limits,
 * not by `maxStorageBufferBindingSize`, so it holds at least what a buffer held. Float `i` sits
 * at column `i % width` of row `i / width`, `FLOAT_ATLAS_ROWS` rows a layer: the same bits the
 * buffer held, read one texel each. Its rows divide its floats whenever a width of at most the
 * device's side allows it, so it weighs the very bytes the buffer did: the memory budgets the
 * engine funds from them see no change.
 */
/** Rows a layer: the side every device grants, a power of two, so the shader splits a row into its
 *  layer and its row by a shift; a device-sized count would cost a division on every read. */
const FLOAT_ATLAS_ROWS = GUARANTEED_SIDE
type AtlasLimits = Parameters<typeof textureLimits>[0]

/** Width and height of a one-layer atlas of `texels` texels: the fewest rows of at most `side`
 *  texels, filled evenly, so that under one texel per row is padding. Its readers take the width
 *  from the texture itself. */
export function atlasExtent(texels: number, side: number): [number, number] {
  const count = Math.max(1, texels)
  const height = ceilDiv(count, side)
  return [ceilDiv(count, height), height]
}

/** Width, rows and layers of an atlas of `floats` floats on a device of `limits`: the fewest rows
 *  that divide them — a layer's rows, or whole layers —; when none does, one layer filled evenly
 *  (`atlasExtent`), or layers of rows of the device's side, padded. */
function floatAtlasExtent(floats: number, limits?: AtlasLimits): [number, number, number] {
  const { side, layers: most } = textureLimits(limits)
  const count = Math.max(1, floats),
    least = ceilDiv(count, side)
  for (let rows = least; rows <= FLOAT_ATLAS_ROWS; rows++)
    if (count % rows === 0) return [count / rows, rows, 1]
  const perLayer = FLOAT_ATLAS_ROWS
  for (let layers = Math.max(2, ceilDiv(least, perLayer)); layers <= most; layers++)
    if (count % (layers * perLayer) === 0) return [count / (layers * perLayer), perLayer, layers]
  const layers = ceilDiv(least, perLayer)
  return layers > 1 ? [side, perLayer, layers] : [...atlasExtent(count, side), 1]
}

/** Whether a device of `limits` makes an atlas of `floats` floats. */
export function floatAtlasFits(floats: number, limits?: AtlasLimits) {
  const [width, rows, layers] = floatAtlasExtent(floats, limits)
  const { side, layers: most } = textureLimits(limits)
  return width <= side && rows <= side && layers <= most
}

/** A zeroed atlas of `floats` floats on `device`, as wide as it grants, and its view, which the
 *  passes bind whole. */
export function createFloatAtlas(device: GPUDevice, label: string, floats: number) {
  const extent = floatAtlasExtent(floats, device.limits)
  const texture = device.createTexture({
    label,
    size: extent,
    format: 'r32float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
  })
  const bytes = extent[0] * extent[1] * extent[2] * 4
  return { texture, extent, bytes, view: texture.createView({ dimension: '2d-array' }) }
}
export type FloatAtlas = ReturnType<typeof createFloatAtlas>

/** Writes `count` floats of `data`, from its float `offset`, at float `at` of `atlas`: whole rows
 *  at once, a partial row alone. Nothing is allocated. */
export function writeFloatAtlas(
  queue: GPUQueue,
  atlas: FloatAtlas,
  at: number,
  data: Float32Array<ArrayBuffer>,
  offset: number,
  count: number,
) {
  const side = atlas.extent[0]
  while (count > 0) {
    const column = at % side,
      row = Math.floor(at / side)
    const y = row % FLOAT_ATLAS_ROWS,
      layer = Math.floor(row / FLOAT_ATLAS_ROWS)
    const rows = column ? 0 : Math.min(Math.floor(count / side), FLOAT_ATLAS_ROWS - y)
    const width = rows ? side : Math.min(count, side - column)
    queue.writeTexture(
      { texture: atlas.texture, origin: [column, y, layer] },
      data,
      { offset: offset * 4, bytesPerRow: side * 4 },
      [width, Math.max(1, rows), 1],
    )
    const written = width * Math.max(1, rows)
    at += written
    offset += written
    count -= written
  }
}

/** `fn name(i:u32)->f32`: float `i` of the atlas bound as `texture` (`texture_2d_array<f32>`),
 *  its row width read from the texture. The layer is the row's quotient by the constant
 *  `FLOAT_ATLAS_ROWS`, not a second division by the width: `⌊⌊i/w⌋/rows⌋ = ⌊i/(w·rows)⌋`. */
export const floatAtlasWgsl = (texture: string, name: string) =>
  `fn ${name}(i:u32)->f32{let w=textureDimensions(${texture}).x;let row=i/w;return textureLoad(${texture},vec2u(i%w,row%${FLOAT_ATLAS_ROWS}u),row/${FLOAT_ATLAS_ROWS}u,0).r;}`
