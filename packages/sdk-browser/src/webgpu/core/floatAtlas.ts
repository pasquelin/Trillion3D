/**
 * THE FLOAT ATLAS (#1410): a list of floats the passes read by index, kept in an `r32float`
 * texture instead of a storage buffer — the float pool's normals and tangents. A texture is no
 * storage buffer, so the passes that read it (the lighting with bounce, the shadow demand) hold
 * the eight storage buffers WebGPU guarantees per stage; and it is bounded by the texture limits,
 * not by `maxStorageBufferBindingSize`, so it holds at least what a buffer held. Float `i` sits
 * at column `i % width` of row `i / width`, `FLOAT_ATLAS_ROWS` rows a layer: the same bits the
 * buffer held, read one texel each. Its rows divide its floats whenever a width of at most
 * `FLOAT_ATLAS_WIDTH` allows it, so it weighs the very bytes the buffer did: the memory budgets
 * the engine funds from them see no change.
 */
export const FLOAT_ATLAS_WIDTH = 8192;
export const FLOAT_ATLAS_ROWS = 8192;
/** Layers every WebGPU device holds (`maxTextureArrayLayers`). */
const FLOAT_ATLAS_LAYERS = 256;

/** Width, rows and layers of an atlas of `floats` floats: the fewest rows that divide them — a
 *  layer's rows, or whole layers —; rows of `FLOAT_ATLAS_WIDTH`, padded, when none does. */
export function floatAtlasExtent(floats: number): [number, number, number] {
  const count = Math.max(1, floats),
    least = Math.ceil(count / FLOAT_ATLAS_WIDTH);
  for (let rows = least; rows <= FLOAT_ATLAS_ROWS; rows++)
    if (count % rows === 0) return [count / rows, rows, 1];
  const perLayer = FLOAT_ATLAS_ROWS;
  for (
    let layers = Math.max(2, Math.ceil(least / perLayer));
    layers <= FLOAT_ATLAS_LAYERS;
    layers++
  )
    if (count % (layers * perLayer) === 0) return [count / (layers * perLayer), perLayer, layers];
  const layers = Math.ceil(least / perLayer);
  return [FLOAT_ATLAS_WIDTH, layers > 1 ? perLayer : least, layers];
}

/** Whether a device of `limits` makes an atlas of `floats` floats: WebGPU's guaranteed limits
 *  when it names none. */
export function floatAtlasFits(
  floats: number,
  limits?: { maxTextureDimension2D?: number; maxTextureArrayLayers?: number },
) {
  const [width, rows, layers] = floatAtlasExtent(floats);
  const side = limits?.maxTextureDimension2D ?? 8192;
  const most = limits?.maxTextureArrayLayers ?? FLOAT_ATLAS_LAYERS;
  return width <= side && rows <= side && layers <= most;
}

/** A zeroed atlas of `floats` floats and its view, which the passes bind whole. */
export function createFloatAtlas(device: GPUDevice, label: string, floats: number) {
  const extent = floatAtlasExtent(floats);
  const texture = device.createTexture({
    label,
    size: extent,
    format: 'r32float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
  });
  const bytes = extent[0] * extent[1] * extent[2] * 4;
  return { texture, extent, bytes, view: texture.createView({ dimension: '2d-array' }) };
}
export type FloatAtlas = ReturnType<typeof createFloatAtlas>;

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
  const side = atlas.extent[0];
  while (count > 0) {
    const column = at % side,
      row = Math.floor(at / side);
    const y = row % FLOAT_ATLAS_ROWS,
      layer = Math.floor(row / FLOAT_ATLAS_ROWS);
    const rows = column ? 0 : Math.min(Math.floor(count / side), FLOAT_ATLAS_ROWS - y);
    const width = rows ? side : Math.min(count, side - column);
    queue.writeTexture(
      { texture: atlas.texture, origin: [column, y, layer] },
      data,
      { offset: offset * 4, bytesPerRow: side * 4 },
      [width, Math.max(1, rows), 1],
    );
    const written = width * Math.max(1, rows);
    at += written;
    offset += written;
    count -= written;
  }
}

/** `fn name(i:u32)->f32`: float `i` of the atlas bound as `texture` (`texture_2d_array<f32>`),
 *  its row width read from the texture. */
export const floatAtlasWgsl = (texture: string, name: string) =>
  `fn ${name}(i:u32)->f32{let w=textureDimensions(${texture}).x;return textureLoad(${texture},vec2u(i%w,(i/w)%${FLOAT_ATLAS_ROWS}u),i/(w*${FLOAT_ATLAS_ROWS}u),0).r;}`;
