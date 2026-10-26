import { ledgerAdmitted } from '../../gpu/core/deviceLedger.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import { countingAllocator, gpuAllocator } from '../../gpu/core/resourceAllocator.ts'
import { SURFACE_CACHE_ATLAS_LABEL } from '../../diagnostic/stage/passLabels.ts'
import {
  atlasFormats,
  BLOCK_FORMATS,
  BLOCK_LAYERS,
  CAPTURE_FORMATS,
  INVALID_DEPTH_WORD,
  stagingOf,
  TILE,
} from './layout.ts'

/**
 * THE ATLASES OF THE SURFACE CACHE: the physical atlas the cards' pages live in, one texture for each
 * of its layers — the depth, the albedo, the normal, the emission, the direct, indirect and final
 * light, and a word for each tile of the radiosity's accumulation (`atlasFormats`) —, and the
 * capture atlas the pages being captured in an image are drawn into (`CAPTURE_FORMATS`), a smaller
 * square of the same pages. Both are squares of `side` texels; the capture atlas is the physical
 * atlas's side over the square root of `surfaceCacheCardCaptureFactor`, never under one card of the
 * greatest resolution (`captureAtlasPages`). They are made where the device's budget leaves room
 * for the whole (`ensureSurfaceAtlases`): the cache is then off, with the reason, where it does not.
 *
 * A COMPRESSED atlas keeps its albedo, normal and emission in blocks (`BLOCK_FORMATS`): those three
 * textures can only be copied into and sampled, so they are made here by hand, kept by name
 * (`blocks`), and come with the staging buffer the encoders write the blocks of an image's pages
 * to (`stagingOf`). The budget is asked for all of it.
 */

/** The usage of every layer: written by a compute pass, drawn into by the pass that clears it, read
 *  by load, copied. */
const usage = () =>
  GPUTextureUsage.TEXTURE_BINDING |
  GPUTextureUsage.STORAGE_BINDING |
  GPUTextureUsage.RENDER_ATTACHMENT |
  GPUTextureUsage.COPY_SRC |
  GPUTextureUsage.COPY_DST

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

/** The textures of the physical atlas and of the capture atlas, asked of `layer`: the one list,
 *  made and counted. */
function allocate(
  layer: LayerMaker,
  side: number,
  captureSide: number,
  compressed: boolean,
  viewRows: number,
) {
  const formats = atlasFormats(compressed)
  const physical = {
    depth: layer('depth', side, formats.depth),
    albedo: layer('albedo', side, formats.albedo),
    normal: layer('normal', side, formats.normal),
    emissive: layer('emissive', side, formats.emissive),
    direct: layer('direct lighting', side, formats.direct),
    indirect: layer('indirect lighting', side, formats.indirect),
    final: layer('final lighting', side, formats.final),
    frames: layer('radiosity frames', Math.max(1, side / TILE), formats.frames),
  }
  const capture = {
    // Past its image, the identifier texture holds the views the page's texels are placed by.
    ids: layer('capture ids', captureSide, CAPTURE_FORMATS.ids, captureSide + viewRows),
    depth: layer('capture depth', captureSide, CAPTURE_FORMATS.depth),
    albedo: layer('capture albedo', captureSide, CAPTURE_FORMATS.albedo),
    normal: layer('capture normal', captureSide, CAPTURE_FORMATS.normal),
    emissive: layer('capture emission', captureSide, CAPTURE_FORMATS.emissive),
  }
  return { physical, capture }
}

/** The bytes the atlases of a `side` and a `captureSide` hold: the allocations themselves, counted, and,
 *  `compressed`, the staging buffer of the blocks. */
function surfaceAtlasBytes(
  side: number,
  captureSide: number,
  compressed: boolean,
  viewRows: number,
) {
  const counting = countingAllocator()
  allocate(
    (name, size, format, height = size) => counting.texture(name, [size, height], format),
    side,
    captureSide,
    compressed,
    viewRows,
  )
  return counting.bytes() + (compressed ? stagingOf(captureSide).bytes : 0)
}

/** The atlases of one size. */
export interface SurfaceAtlases {
  /** The physical atlas's layers and the capture atlas's, as views. */
  readonly physical: ReturnType<typeof allocate>['physical']
  readonly capture: ReturnType<typeof allocate>['capture']
  /** Their sides, in texels. */
  readonly side: number
  readonly captureSide: number
  /** The rows of views the capture's identifier texture holds past its image: the pages an image draws at most. */
  readonly viewRows: number
  /** Whether the albedo, normal and emission are kept in blocks (BC7, BC5, BC6H): the emission is then a
   *  float texture, not a layer of words of light. */
  readonly compressed: boolean
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
   *  surface, the rest to nothing — in render passes on `encoder`; the layers in blocks are cleared by
   *  `createBlockClear`. */
  clear(encoder: GPUCommandEncoder): void
  dispose(): void
}

/** The textures of the blocks, made by hand and kept by layer, and the layer maker over `allocator` that
 *  makes them. */
function blockLayers(device: GPUDevice, allocator: ReturnType<typeof gpuAllocator>) {
  const kept = new Map<string, GPUTexture>()
  const layer: LayerMaker = (name, size, format, height = size) => {
    if (!(Object.values(BLOCK_FORMATS) as GPUTextureFormat[]).includes(format))
      return allocator.texture(name, [size, height], format, { usage: usage() })
    const texture = device.createTexture({
      label: `${SURFACE_CACHE_ATLAS_LABEL} ${name}`,
      size: [size, size],
      format,
      usage: blockUsage(),
    })
    kept.set(name, texture)
    return texture.createView()
  }
  return { layer, kept }
}

function makeAtlases(
  device: GPUDevice,
  side: number,
  captureSide: number,
  compressed: boolean,
  viewRows: number,
  bytes: number,
): SurfaceAtlases {
  const allocator = gpuAllocator(device, SURFACE_CACHE_ATLAS_LABEL)
  const { layer, kept } = blockLayers(device, allocator)
  const { physical, capture } = allocate(layer, side, captureSide, compressed, viewRows)
  const blocks: SurfaceAtlases['blocks'] = compressed
    ? {
        textures: Object.fromEntries(
          BLOCK_LAYERS.map((name) => [name, kept.get(name)!]),
        ) as NonNullable<SurfaceAtlases['blocks']>['textures'],
        staging: device.createBuffer({
          label: `${SURFACE_CACHE_ATLAS_LABEL} block staging`,
          size: stagingOf(captureSide).bytes,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        }),
      }
    : undefined
  return {
    physical,
    capture,
    side,
    captureSide,
    viewRows,
    compressed,
    blocks,
    bytes,
    cleared: false,
    clear(encoder) {
      for (const [name, view] of Object.entries(physical)) {
        if (compressed && name in BLOCK_FORMATS) continue
        const value = name === 'depth' ? CLEAR.depth : 0
        encoder
          .beginRenderPass({
            label: `${SURFACE_CACHE_ATLAS_LABEL} clear ${name}`,
            colorAttachments: [
              { view, loadOp: 'clear', storeOp: 'store', clearValue: [value, 0, 0, 0] },
            ],
          })
          .end()
      }
      this.cleared = true
    },
    dispose: () =>
      retire(device, {
        destroy() {
          allocator.destroy()
          for (const texture of kept.values()) texture.destroy()
          blocks?.staging.destroy()
        },
      }),
  }
}

/**
 * The atlases of `side` and `captureSide`, `compressed` or not: the ones `held` where they are those
 * sizes and that kind, else made, the old ones given back — made where the device's budget leaves room,
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
  extra = 0,
): { atlases?: SurfaceAtlases; why?: string } {
  if (
    held &&
    held.side === side &&
    held.captureSide === captureSide &&
    held.viewRows === viewRows &&
    held.compressed === compressed
  )
    return { atlases: held }
  const bytes = surfaceAtlasBytes(side, captureSide, compressed, viewRows)
  const { value, why } = ledgerAdmitted(device, {
    held,
    asked: bytes + extra,
    what: 'the surface cache',
    make: () => makeAtlases(device, side, captureSide, compressed, viewRows, bytes),
  })
  return { atlases: value, why }
}
