import { ledgerAdmitted } from '../../gpu/core/deviceLedger.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import { countingAllocator, gpuAllocator } from '../../gpu/core/resourceAllocator.ts'
import { SURFACE_CACHE_ATLAS_LABEL } from '../../diagnostic/stage/passLabels.ts'
import type { LightAtlasFormat } from '../../gpu/core/lightAtlasFormat.ts'
import { lightWordsOf } from '../../gpu/core/lightWords.ts'
import { shadowFactorWords } from './lighting/layout.ts'
import {
  atlasFormats,
  BLOCK_FORMATS,
  BLOCK_LAYERS,
  captureFormats,
  INVALID_DEPTH_WORD,
  stagingOf,
  TILE,
} from './layout.ts'

/**
 * THE ATLASES OF THE SURFACE CACHE: the physical atlas the cards' pages live in, one texture for each
 * of its layers — the depth, the albedo, the normal, the emission, the direct, indirect and final
 * light, and a word for each tile of the radiosity's accumulation (`atlasFormats`) —, and the
 * capture atlas the pages being captured in an image are drawn into (`captureFormats`), a smaller
 * square of the same pages. Both are squares of `side` texels; the capture atlas is the physical
 * atlas's side over the square root of `surfaceCacheCardCaptureFactor`, never under one card of the
 * greatest resolution (`captureAtlasPages`). They are made where the device's budget leaves room
 * for the whole (`ensureSurfaceAtlases`): the cache is then off, with the reason, where it does not. The direct and final light are stored in the
 * format the lighting data format asks (`light`, `lightAtlasFormat`), the indirect light in the words it takes (`lightWordsOf`): an atlas is made
 * again where that format moved, as it is where its size does.
 *
 * A COMPRESSED atlas keeps its albedo, normal and emission in blocks (`BLOCK_FORMATS`): those three
 * textures can only be copied into and sampled, so they are made here by hand, kept by name
 * (`blocks`), and come with the staging buffer the encoders write the blocks of an image's pages
 * to (`stagingOf`). The budget is asked for all of it.
 *
 * Beside the layers, each atlas keeps the factor atlas of the direct light's shadows (`shadowFactorWords`): a word
 * buffer of 8 words a tile of 8 × 8 texels, a bit a light, which tells the next update of the tile which lights it saw
 * uniformly. The capture atlas's is the one the light of resampled pages is carried through; both are emptied with
 * the layers.
 */

/** The format a layer of light takes where the device grants `texture-formats-tier1` and the setting asks for 11-11-10 floats (`lightAtlasFormat`): it is a storage
 *  texture there, but renders only on a device that also grants `rg11b10ufloat-renderable`, so no render pass clears it: copies of zeros do (`clearByCopies`). */
const NATIVE_LIGHT_FORMAT = 'rg11b10ufloat' satisfies LightAtlasFormat

/** The usage of every layer of `format`: written by a compute pass, drawn into by the pass that clears it, read
 *  by load, copied. */
const usage = (format: GPUTextureFormat) =>
  GPUTextureUsage.TEXTURE_BINDING |
  GPUTextureUsage.STORAGE_BINDING |
  (format === NATIVE_LIGHT_FORMAT ? 0 : GPUTextureUsage.RENDER_ATTACHMENT) |
  GPUTextureUsage.COPY_SRC |
  GPUTextureUsage.COPY_DST

/** The bytes of the buffer of zeros the layers no render pass clears are cleared from, a strip of rows at a time. */
const ZERO_STRIP_BYTES = 1 << 20

/** The usage of a block-compressed layer: the copies of blocks write it, the passes sample it. */
const blockUsage = () => GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST

/** The value a layer is cleared to: the depth's of a texel with no surface, nothing for the rest. */
const CLEAR = { depth: INVALID_DEPTH_WORD } as const

/** What makes the texture of a layer, a square of `size` texels named `name`, and gives its view. */
type LayerMaker = (
  name: string,
  size: number,
  format: GPUTextureFormat,
  height?: number,
) => GPUTextureView

/** What makes the buffer of a factor atlas, `words` long, named `name`. */
type BufferMaker = (name: string, words: number) => GPUBuffer

/** The textures of the physical atlas and of the capture atlas, asked of `layer`, and their factor atlases, asked of
 *  `buffer`: the one list, made and counted. */
function allocate(
  layer: LayerMaker,
  buffer: BufferMaker,
  side: number,
  captureSide: number,
  compressed: boolean,
  viewRows: number,
  light: LightAtlasFormat,
) {
  const formats = atlasFormats(compressed, light)
  const captured = captureFormats(light)
  const words = lightWordsOf(light)
  const physical = {
    depth: layer('depth', side, formats.depth),
    albedo: layer('albedo', side, formats.albedo),
    normal: layer('normal', side, formats.normal),
    emissive: layer('emissive', side, formats.emissive),
    direct: layer('direct lighting', side, formats.direct),
    indirect: layer('indirect lighting', side * words, formats.indirect, side),
    final: layer('final lighting', side, formats.final),
    frames: layer('radiosity frames', Math.max(1, side / TILE), formats.frames),
  }
  const capture = {
    // Past its image, the identifier texture holds the views the page's texels are placed by.
    ids: layer('capture ids', captureSide, captured.ids, captureSide + viewRows),
    depth: layer('capture depth', captureSide, captured.depth),
    albedo: layer('capture albedo', captureSide, captured.albedo),
    normal: layer('capture normal', captureSide, captured.normal),
    emissive: layer('capture emission', captureSide, captured.emissive),
    direct: layer('capture direct lighting', captureSide, captured.direct),
    indirect: layer(
      'capture indirect lighting',
      captureSide * words,
      captured.indirect,
      captureSide,
    ),
    frames: layer('capture radiosity frames', Math.max(1, captureSide / TILE), captured.frames),
  }
  return {
    physical,
    capture,
    factors: buffer('shadow factors', shadowFactorWords(side)),
    captureFactors: buffer('capture shadow factors', shadowFactorWords(captureSide)),
  }
}

/** The bytes the atlases of a `side` and a `captureSide` hold: the allocations themselves, counted, and,
 *  `compressed`, the staging buffer of the blocks. */
function surfaceAtlasBytes(
  side: number,
  captureSide: number,
  compressed: boolean,
  viewRows: number,
  light: LightAtlasFormat,
) {
  const counting = countingAllocator()
  allocate(
    (name, size, format, height = size) => counting.texture(name, [size, height], format),
    (name, words) => counting.buffer(name, words),
    side,
    captureSide,
    compressed,
    viewRows,
    light,
  )
  return counting.bytes() + (compressed ? stagingOf(captureSide).bytes : 0)
}

/** The atlases of one size. */
export interface SurfaceAtlases {
  /** The physical atlas's layers and the capture atlas's, as views. */
  readonly physical: ReturnType<typeof allocate>['physical']
  readonly capture: ReturnType<typeof allocate>['capture']
  /** The factor atlases of the physical atlas and of the capture atlas (`shadowFactorWords`). */
  readonly factors: GPUBuffer
  readonly captureFactors: GPUBuffer
  /** Their sides, in texels. */
  readonly side: number
  readonly captureSide: number
  /** The rows of views the capture's identifier texture holds past its image: the pages an image draws at most. */
  readonly viewRows: number
  /** Whether the albedo, normal and emission are kept in blocks (BC7, BC5, BC6H): the emission is then a
   *  float texture, not a layer of words of light. */
  readonly compressed: boolean
  /** The format the direct and final light are stored in (`lightAtlasFormat`); the indirect light takes its words (`lightWordsOf`). */
  readonly light: LightAtlasFormat
  /** The textures of the three layers in blocks, which the copies of blocks name, and the buffer the
   *  encoders write the blocks to; none unless `compressed`. */
  readonly blocks?: {
    readonly textures: Readonly<Record<(typeof BLOCK_LAYERS)[number], GPUTexture>>
    readonly staging: GPUBuffer
  }
  /** The bytes they hold. */
  readonly bytes: number
  /** Whether they hold their first content: `clear` has been encoded for them. */
  cleared: boolean
  /** Clears every layer of the physical atlas that a render pass can — the depth to a texel with no
   *  surface, the rest to nothing — in render passes on `encoder`, and the two factor atlases; the layers in
   *  blocks are cleared by `createBlockClear`. */
  clear(encoder: GPUCommandEncoder): void
  /** Clears the layer `name` of the physical atlas to nothing, in the way its format is cleared. */
  clearLayer(encoder: GPUCommandEncoder, name: 'direct'): void
  dispose(): void
}

/** The textures of the blocks, made by hand and kept by layer, the textures of the layers cleared by copies (`NATIVE_LIGHT_FORMAT`) kept by their views, and the layer
 *  maker over `allocator` that makes them. */
function blockLayers(device: GPUDevice, allocator: ReturnType<typeof gpuAllocator>) {
  const kept = new Map<string, GPUTexture>()
  const copied = new Map<GPUTextureView, GPUTexture>()
  const layer: LayerMaker = (name, size, format, height = size) => {
    if (format === NATIVE_LIGHT_FORMAT) {
      const texture = allocator.image(name, [size, height], format, { usage: usage(format) })
      const view = texture.createView()
      copied.set(view, texture)
      return view
    }
    if (!(Object.values(BLOCK_FORMATS) as GPUTextureFormat[]).includes(format))
      return allocator.texture(name, [size, height], format, { usage: usage(format) })
    const texture = device.createTexture({
      label: `${SURFACE_CACHE_ATLAS_LABEL} ${name}`,
      size: [size, size],
      format,
      usage: blockUsage(),
    })
    kept.set(name, texture)
    return texture.createView()
  }
  return { layer, kept, copied }
}

/** The three layers in blocks, by name, and the staging buffer the encoders write the blocks of an
 *  image's pages to. */
function blocksOf(
  device: GPUDevice,
  kept: ReadonlyMap<string, GPUTexture>,
  captureSide: number,
): NonNullable<SurfaceAtlases['blocks']> {
  return {
    textures: Object.fromEntries(
      BLOCK_LAYERS.map((name) => [name, kept.get(name)!]),
    ) as NonNullable<SurfaceAtlases['blocks']>['textures'],
    staging: device.createBuffer({
      label: `${SURFACE_CACHE_ATLAS_LABEL} block staging`,
      size: stagingOf(captureSide).bytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    }),
  }
}

/** Clears the layer `texture` of 4-byte texels, no render pass's attachment, with copies from `zeros`, a strip of rows at a time. */
function clearByCopies(encoder: GPUCommandEncoder, texture: GPUTexture, zeros: GPUBuffer) {
  const bytesPerRow = texture.width * 4
  const rows = Math.max(1, Math.floor(ZERO_STRIP_BYTES / bytesPerRow))
  for (let y = 0; y < texture.height; y += rows)
    encoder.copyBufferToTexture({ buffer: zeros, bytesPerRow }, { texture, origin: [0, y] }, [
      texture.width,
      Math.min(rows, texture.height - y),
    ])
}

/** Clears the layer `name` of the physical atlas, a render pass's attachment, to `value` in one pass. */
function clearLayer(
  encoder: GPUCommandEncoder,
  name: string,
  view: GPUTextureView,
  value = 0,
): void {
  encoder
    .beginRenderPass({
      label: `${SURFACE_CACHE_ATLAS_LABEL} clear ${name}`,
      colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: [value, 0, 0, 0] }],
    })
    .end()
}

/** Clears the layers of the physical atlas that a render pass can — the depth to a texel with no
 *  surface, the rest to nothing — one pass each, those no render pass can by copies of zeros; the layers in blocks are left to `createBlockClear`. */
function clearLayers(
  encoder: GPUCommandEncoder,
  physical: SurfaceAtlases['physical'],
  compressed: boolean,
  copied: ReadonlyMap<GPUTextureView, GPUTexture>,
  zeros: GPUBuffer | undefined,
): void {
  for (const [name, view] of Object.entries(physical)) {
    if (compressed && name in BLOCK_FORMATS) continue
    const texture = copied.get(view)
    if (texture) clearByCopies(encoder, texture, zeros!)
    else clearLayer(encoder, name, view, name === 'depth' ? CLEAR.depth : 0)
  }
}

/** The buffer of zeros the layers cleared by copies are cleared from. */
const zeroStrip = (device: GPUDevice) =>
  device.createBuffer({
    label: `${SURFACE_CACHE_ATLAS_LABEL} zeros`,
    size: ZERO_STRIP_BYTES,
    usage: GPUBufferUsage.COPY_SRC,
  })

function makeAtlases(
  device: GPUDevice,
  side: number,
  captureSide: number,
  compressed: boolean,
  viewRows: number,
  light: LightAtlasFormat,
  bytes: number,
): SurfaceAtlases {
  const allocator = gpuAllocator(device, SURFACE_CACHE_ATLAS_LABEL)
  const { layer, kept, copied } = blockLayers(device, allocator)
  const { physical, capture, factors, captureFactors } = allocate(
    layer,
    (name, words) => allocator.buffer(name, words, 'storage'),
    side,
    captureSide,
    compressed,
    viewRows,
    light,
  )
  const blocks = compressed ? blocksOf(device, kept, captureSide) : undefined
  const zeros = copied.size ? zeroStrip(device) : undefined
  return {
    physical,
    capture,
    factors,
    captureFactors,
    side,
    captureSide,
    viewRows,
    compressed,
    light,
    blocks,
    bytes,
    cleared: false,
    clear(encoder) {
      clearLayers(encoder, physical, compressed, copied, zeros)
      encoder.clearBuffer(factors)
      encoder.clearBuffer(captureFactors)
      this.cleared = true
    },
    clearLayer(encoder, name) {
      const texture = copied.get(physical[name])
      if (texture) clearByCopies(encoder, texture, zeros!)
      else clearLayer(encoder, name, physical[name])
    },
    dispose: () =>
      retire(device, {
        destroy() {
          allocator.destroy()
          for (const texture of kept.values()) texture.destroy()
          blocks?.staging.destroy()
          zeros?.destroy()
        },
      }),
  }
}

/**
 * The atlases of `side` and `captureSide`, `compressed` or not, their light stored in `light`: the ones `held` where they are those
 * sizes, that kind and that format, else made, the old ones given back — made where the device's budget leaves room,
 * the bytes the old ones give back credited (`ledgerAdmitted`); none where it does not, with the reason
 * (`why`, for the frame's metrics). `extra` is the bytes of what the caller makes beside them, so that
 * the budget is asked for the whole.
 */
export function ensureSurfaceAtlases(
  held: SurfaceAtlases | undefined,
  device: GPUDevice,
  side: number,
  captureSide: number,
  compressed: boolean,
  viewRows: number,
  light: LightAtlasFormat,
  extra = 0,
): { atlases?: SurfaceAtlases; why?: string } {
  if (
    held &&
    held.side === side &&
    held.captureSide === captureSide &&
    held.viewRows === viewRows &&
    held.compressed === compressed &&
    held.light === light
  )
    return { atlases: held }
  const bytes = surfaceAtlasBytes(side, captureSide, compressed, viewRows, light)
  const { value, why } = ledgerAdmitted(device, {
    held,
    asked: bytes + extra,
    what: 'the surface cache',
    make: () => makeAtlases(device, side, captureSide, compressed, viewRows, light, bytes),
  })
  return { atlases: value, why }
}
