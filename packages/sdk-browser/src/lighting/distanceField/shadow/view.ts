import { shapeView } from '../../../gpu/core/shapeView.ts'
import { textureBytesOf } from '../../../gpu/core/textureBytes.ts'
import { viewResources, type ViewTexture } from '../viewResources.ts'
import {
  DFSH_FINAL_BYTES,
  DFSH_HALF_FORMAT,
  DFSH_PARAMS_STRIDE,
  DFSH_STAND_IN_FORMAT,
  dfshMaskWords,
} from './layout.ts'
import { downsampleOf, traceSize } from './params.ts'

const LABEL = 'Trillion3D sun distance-field shadow'

/**
 * What decides the size of a view's resources: the buffers' extent and the view's size, the meshes
 * the lists have room for (rounded up to 256), the side of the largest grid of tiles, the meshes a
 * tile has room for, the lanes of the mask in use (the layers of the half-resolution result) and
 * whether it is traced at the display's resolution. The grid, the lanes and the meshes only grow.
 */
export interface DfshShape {
  extent: readonly [number, number]
  view: readonly [number, number]
  objects: number
  tiles: number
  perTile: number
  layers: number
  fullResolution: boolean
}

/**
 * A VIEW'S SUN-SHADOW RESOURCES, at the extent its buffers are made at: the uniforms (a block a
 * light, and the final pass's), the half-resolution result (a band of rows a lane), the mask the
 * lit image reads (a buffer), the list of the meshes the cascade reaches and the draw's arguments, the tiles'
 * counts, offsets and lists, the running total of the offsets and the target the scatter draws into.
 * Held on the frame's distance-field state and counted in its bytes.
 */
export interface DfshView {
  readonly shape: DfshShape
  readonly params: GPUBuffer
  readonly final: GPUBuffer
  readonly half: ViewTexture
  readonly mask: GPUBuffer
  readonly culledObjects: GPUBuffer
  readonly objectArgs: GPUBuffer
  readonly tileCounts: GPUBuffer
  readonly tileOffsets: GPUBuffer
  readonly tileData: GPUBuffer
  readonly nextOffset: GPUBuffer
  readonly standIn: ViewTexture
  /** The bind groups the passes were made over, kept while what they name is the same (`groups.ts`). */
  groups: unknown
  readonly bytes: number
  dispose(): void
}

/** The key two shapes that agree on agree on. */
const dfshShapeKey = (s: DfshShape) =>
  `${s.extent}|${s.view}|${s.objects}|${s.tiles}|${s.perTile}|${s.layers}|${s.fullResolution}`

/** The size of the half-resolution result of a shape: the rows of all its lanes, stacked. */
const halfExtent = (s: DfshShape) => {
  const [width, height] = traceSize(s.view, downsampleOf(s))
  return [width, height * s.layers] as const
}

/** The sizes in bytes of the buffers of a shape, by name. */
function bufferSizes(shape: DfshShape) {
  const tiles = shape.tiles * shape.tiles
  return {
    params: DFSH_PARAMS_STRIDE * 4,
    final: DFSH_FINAL_BYTES,
    mask: dfshMaskWords(shape.extent[0] * shape.extent[1]) * 4,
    culledObjects: shape.objects * 4,
    objectArgs: 16,
    tileCounts: tiles * 4,
    tileOffsets: tiles * 4,
    tileData: shape.perTile * tiles * 4,
    nextOffset: 4,
  }
}

/** The bytes a view of `shape` holds: its textures and buffers. */
function dfshViewBytes(shape: DfshShape) {
  const texture = (size: readonly number[], format: GPUTextureFormat) =>
    textureBytesOf({ size: [size[0], size[1]], format }) ?? 0
  return (
    Object.values(bufferSizes(shape)).reduce((sum, bytes) => sum + bytes, 0) +
    texture(halfExtent(shape), DFSH_HALF_FORMAT) +
    texture([shape.tiles, shape.tiles], DFSH_STAND_IN_FORMAT)
  )
}

/** Makes the view of `shape` (`DfshView`). */
function makeView(device: GPUDevice, shape: DfshShape, bytes: number): DfshView {
  const sizes = bufferSizes(shape)
  const { buffer: bufferOf, texture, dispose } = viewResources(device, LABEL)
  // Read when a view is made: the usage flags are the device's globals, which the modules that import this one may not have.
  const STORAGE = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  const buffer = (name: keyof typeof sizes, usage: number) => bufferOf(name, sizes[name], usage)
  const sampled = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
  return {
    shape,
    params: buffer('params', GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST),
    final: buffer('final', GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST),
    half: texture('half', halfExtent(shape), DFSH_HALF_FORMAT, sampled),
    mask: buffer('mask', STORAGE),
    culledObjects: buffer('culledObjects', STORAGE),
    objectArgs: buffer('objectArgs', STORAGE | GPUBufferUsage.INDIRECT),
    // The lists are copied out to the cards' direct light (`surfaceCache/lighting/meshShadow.ts`).
    tileCounts: buffer('tileCounts', STORAGE | GPUBufferUsage.COPY_SRC),
    tileOffsets: buffer('tileOffsets', STORAGE | GPUBufferUsage.COPY_SRC),
    tileData: buffer('tileData', STORAGE | GPUBufferUsage.COPY_SRC),
    nextOffset: buffer('nextOffset', STORAGE),
    standIn: texture(
      'stand-in',
      [shape.tiles, shape.tiles],
      DFSH_STAND_IN_FORMAT,
      GPUTextureUsage.RENDER_ATTACHMENT,
    ),
    groups: undefined,
    bytes,
    dispose,
  }
}

/**
 * The view of `shape`: the one `held` while it is that, else made, the old one given back — made
 * where the device's budget leaves room (`ledgerAdmitted`, the bytes the old one gives back
 * credited); none where it does not, and the reason: the image is then lit without the cascade.
 */
export function ensureDfshView(
  held: DfshView | undefined,
  device: GPUDevice,
  shape: DfshShape,
): { view?: DfshView; why?: string } {
  return shapeView(held, device, {
    same: held !== undefined && dfshShapeKey(held.shape) === dfshShapeKey(shape),
    what: 'the sun’s distance-field shadow',
    bytes: () => dfshViewBytes(shape),
    make: (asked) => makeView(device, shape, asked),
  })
}
