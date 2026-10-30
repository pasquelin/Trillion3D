import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { computeStorageTextureEntry } from '../../gpu/core/computeBindings.ts'

/** The pixels along a tile of the front layer's mask: the tiles of the sampled lighting's classification are the same eight. */
export const FRONT_TILE_SIZE = 8
/** The bind group the front stage binds the mask in (the blend's is group 0), and the mask's binding in it. */
export const FRONT_TILE_GROUP = 1
export const FRONT_TILE_BINDING = 0
/** The format of the mask: a word a tile, a texture the fragment writes and the list kernel reads. */
export const FRONT_TILE_FORMAT: GPUTextureFormat = 'r32uint'

/** The layout of the mask as the front stage's fragment writes it: write-only, nothing of it read there. */
export const frontTileLayout = oncePerDevice((device: GPUDevice) =>
  device.createBindGroupLayout({
    entries: [
      computeStorageTextureEntry(
        FRONT_TILE_BINDING,
        FRONT_TILE_FORMAT,
        'write-only',
        '2d',
        GPUShaderStage.FRAGMENT,
      ),
    ],
  }),
)

/**
 * THE TILES THE FRONT LAYER LIGHTS: the mask the front pass marks (a word a tile of eight pixels, 1 where a fragment of a layer the sampled
 * lighting lights was written), and the compact list built from it for the classification of those tiles alone (`allocator`: the count, `data`:
 * the tiles packed `x | y << 16`, `args`: the arguments of the dispatch over them). The mask and the count are cleared where they are made, by the front pass before it draws (`beginFrontTiles`): a mask is born empty each image,
 * so that an image whose list is not built leaves no marks for the next.
 */
export interface FrontTiles {
  readonly mask: GPUTexture
  readonly maskView: GPUTextureView
  /** The group the front stage's fragment writes the mask through. */
  readonly maskGroup: GPUBindGroup
  /** The descriptor of the pass that clears the mask, made once with the tiles (the mask's view never changes) and reused each image. */
  readonly clearPass: GPURenderPassDescriptor
  readonly allocator: GPUBuffer
  readonly data: GPUBuffer
  readonly args: GPUBuffer
  destroy(): void
}

/** The tiles of an image of `width × height` pixels. */
export const frontTileGrid = (width: number, height: number) =>
  [ceilDiv(width, FRONT_TILE_SIZE), ceilDiv(height, FRONT_TILE_SIZE)] as const

/** The bytes of the tiles of an image of `width × height` pixels: the mask and the list, a word a tile each, the count and the arguments. */
export const frontTileBytes = (width: number, height: number) => {
  const [x, y] = frontTileGrid(width, height)
  return 2 * 4 * x * y + 16 + 16
}

/** The tiles of the image empty, where the pass that marks them begins: the mask cleared (a pass that only clears it) and the count reset. */
export function beginFrontTiles(encoder: GPUCommandEncoder, tiles: FrontTiles) {
  encoder.clearBuffer(tiles.allocator)
  encoder.beginRenderPass(tiles.clearPass).end()
}

/** The front layer's tiles at `width × height`. */
export function createFrontTiles(device: GPUDevice, width: number, height: number): FrontTiles {
  const label = 'Trillion3D front layer tiles'
  const [x, y] = frontTileGrid(width, height)
  const mask = device.createTexture({
    label,
    size: [x, y],
    format: FRONT_TILE_FORMAT,
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
  })
  const maskView = mask.createView()
  const buffer = (name: string, size: number, usage: number) =>
    device.createBuffer({
      label: `${label} ${name}`,
      size,
      usage: GPUBufferUsage.STORAGE | usage,
    })
  const allocator = buffer('count', 16, GPUBufferUsage.COPY_DST)
  const data = buffer('list', Math.max(16, 4 * x * y), 0)
  const args = buffer('arguments', 16, GPUBufferUsage.INDIRECT)
  return {
    mask,
    maskView,
    maskGroup: device.createBindGroup({
      label,
      layout: frontTileLayout(device),
      entries: [{ binding: FRONT_TILE_BINDING, resource: maskView }],
    }),
    clearPass: {
      label: 'Trillion3D front layer tiles clear',
      colorAttachments: [
        { view: maskView, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] },
      ],
    },
    allocator,
    data,
    args,
    destroy() {
      for (const resource of [mask, allocator, data, args]) resource.destroy()
    },
  }
}
