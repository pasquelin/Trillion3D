import { shapeView } from '../../../gpu/core/shapeView.ts'
import { textureBytesOf } from '../../../gpu/core/textureBytes.ts'
import { viewResources, type ViewTexture } from '../viewResources.ts'
import { DFSH_PARAMS_STRIDE, DFSH_STAND_IN_FORMAT } from './layout.ts'

const LABEL = 'Trillion3D sun distance-field shadow'

/**
 * What decides the size of a view's resources: the meshes the lists have room for (rounded up to
 * 256), the side of the largest grid of tiles and the meshes a tile has room for. The grid and the
 * meshes only grow.
 */
export interface DfshShape {
  objects: number
  tiles: number
  perTile: number
}

/**
 * THE SUNS' MESH LISTS RESOURCES: the uniform (a block a sun), the list of the meshes the volume
 * reaches and the draw's arguments, the tiles' counts, offsets and lists, the running total of the
 * offsets and the target the scatter draws into. Held on the surface cache's state and counted in its bytes.
 */
export interface DfshView {
  readonly shape: DfshShape
  readonly params: GPUBuffer
  readonly culledObjects: GPUBuffer
  readonly objectArgs: GPUBuffer
  readonly tileCounts: GPUBuffer
  readonly tileOffsets: GPUBuffer
  readonly tileData: GPUBuffer
  readonly nextOffset: GPUBuffer
  readonly standIn: ViewTexture
  readonly bytes: number
  dispose(): void
}

/** The key two shapes that agree on agree on. */
const dfshShapeKey = (s: DfshShape) => `${s.objects}|${s.tiles}|${s.perTile}`

/** The sizes in bytes of the buffers of a shape, by name. */
function bufferSizes(shape: DfshShape) {
  const tiles = shape.tiles * shape.tiles
  return {
    params: DFSH_PARAMS_STRIDE * 4,
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
  return (
    Object.values(bufferSizes(shape)).reduce((sum, bytes) => sum + bytes, 0) +
    (textureBytesOf({ size: [shape.tiles, shape.tiles], format: DFSH_STAND_IN_FORMAT }) ?? 0)
  )
}

/** Makes the view of `shape` (`DfshView`). */
function makeView(device: GPUDevice, shape: DfshShape, bytes: number): DfshView {
  const sizes = bufferSizes(shape)
  const { sized: buffer, texture, dispose } = viewResources(device, LABEL, sizes)
  // Read when a view is made: the usage flags are the device's globals, which the modules that import this one may not have.
  const STORAGE = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  return {
    shape,
    params: buffer('params', GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST),
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
    bytes,
    dispose,
  }
}

/**
 * The view of `shape`: the one `held` while it is that, else made, the old one given back — made
 * where the device's budget leaves room (`ledgerAdmitted`, the bytes the old one gives back
 * credited); none where it does not, and the reason: the cards are then lit through the global field.
 */
export function ensureDfshView(
  held: DfshView | undefined,
  device: GPUDevice,
  shape: DfshShape,
): { view?: DfshView; why?: string } {
  return shapeView(held, device, {
    same: held !== undefined && dfshShapeKey(held.shape) === dfshShapeKey(shape),
    what: 'the suns’ mesh lists',
    bytes: () => dfshViewBytes(shape),
    make: (asked) => makeView(device, shape, asked),
  })
}
