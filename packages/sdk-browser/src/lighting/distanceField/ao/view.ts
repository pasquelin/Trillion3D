import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import {
  budgetRefused,
  ledgerReplacing,
  ledgerRoom,
  ledgerTentative,
} from '../../../gpu/core/deviceLedger.ts'
import { constructGpuResources } from '../../../gpu/core/errorScope.ts'
import { retire } from '../../../gpu/core/frameRetire.ts'
import { textureBytesOf } from '../../../gpu/core/textureBytes.ts'
import { occlusionBuffers, tileCounts, CONE_DIRECTIONS } from './cones.ts'
import { CULLED_TILE_DATA_STRIDE } from './coneObjectsWgsl.ts'
import {
  DFAO_BENT_FORMAT,
  DFAO_NORMAL_FORMAT,
  DFAO_PARAMS_BYTES,
  DFAO_STAND_IN_FORMAT,
} from './layout.ts'

const LABEL = 'Trillion3D distance-field occlusion'

/** A texture of the occlusion and the view the passes bind it through. */
export interface DfaoTexture {
  readonly texture: GPUTexture
  readonly view: GPUTextureView
}

/** What decides the size of a view's resources: the extent of the scene's buffers, the meshes the lists have room for
 *  (rounded up to 256), and the meshes a tile has room for. */
export interface DfaoShape {
  extent: readonly [number, number]
  objects: number
  perTile: number
}

/** The meshes the lists have room for: `count` rounded up to a multiple of 256. */
export const objectCapacity = (count: number) => Math.max(1, ceilDiv(count, 256)) * 256

/**
 * A VIEW'S OCCLUSION RESOURCES, at the extent its buffers are made at: the normals and depths grid, the bent normals at
 * the cones' size, the history and the image being built (two textures that take turns), the uniform, the cones'
 * visibilities, the lists of the meshes the view reaches and of the screen tiles each reaches — their runs, counts,
 * the cone traces' dispatch — and the target the scatter draws into. Held on the view's GPU state and counted in its
 * bytes; the history says where it is (`historyAt`, the texture that holds it), whether it is valid and the size of
 * the view it was drawn at.
 */
export interface DfaoView {
  readonly shape: DfaoShape
  readonly normals: DfaoTexture
  readonly cones: DfaoTexture
  readonly history: readonly [DfaoTexture, DfaoTexture]
  readonly params: GPUBuffer
  readonly visibility: GPUBuffer
  readonly culledObjects: GPUBuffer
  readonly objectArgs: GPUBuffer
  readonly tileAxis: GPUBuffer
  readonly tileRanges: GPUBuffer
  readonly tileCounts: GPUBuffer
  readonly tileOffsets: GPUBuffer
  readonly tileData: GPUBuffer
  readonly tileArgs: GPUBuffer
  readonly standIn: DfaoTexture
  /** The texture of `history` that holds the last image's result, and whether it is to be read. */
  historyAt: 0 | 1
  historyValid: boolean
  lastView: readonly [number, number] | undefined
  /** The bind groups the passes were made over, kept while what they name is the same (`frame.ts`). */
  groups: unknown
  readonly bytes: number
  dispose(): void
}

/** The key two shapes that agree on agree on. */
export const dfaoShapeKey = (s: DfaoShape) => `${s.extent}|${s.objects}|${s.perTile}`

/** The sizes in bytes of the buffers of a shape, by name. */
function bufferSizes(shape: DfaoShape) {
  const { grid, cones } = occlusionBuffers(shape.extent)
  const tiles = tileCounts(shape.extent[0], shape.extent[1])
  const tileTotal = tiles[0] * tiles[1]
  return {
    grid,
    cones,
    tiles,
    sizes: {
      params: DFAO_PARAMS_BYTES,
      visibility: CONE_DIRECTIONS * cones[0] * cones[1] * 4,
      culledObjects: shape.objects * 4,
      objectArgs: 20,
      tileAxis: tileTotal * 16,
      tileRanges: tileTotal * 16,
      tileCounts: shape.objects * 4,
      tileOffsets: shape.objects * 4,
      tileData: shape.perTile * tileTotal * CULLED_TILE_DATA_STRIDE * 4,
      tileArgs: 12,
    },
  }
}

/** The bytes a view of `shape` holds: its textures and buffers. */
export function dfaoViewBytes(shape: DfaoShape) {
  const { grid, cones, tiles, sizes } = bufferSizes(shape)
  const texture = (size: readonly number[], format: GPUTextureFormat) =>
    textureBytesOf({ size: [size[0], size[1]], format }) ?? 0
  return (
    Object.values(sizes).reduce((sum, bytes) => sum + bytes, 0) +
    texture(grid, DFAO_NORMAL_FORMAT) +
    texture(cones, DFAO_BENT_FORMAT) +
    2 * texture(grid, DFAO_BENT_FORMAT) +
    texture(tiles, DFAO_STAND_IN_FORMAT)
  )
}

/** Makes the view of `shape` (`DfaoView`). */
function makeView(device: GPUDevice, shape: DfaoShape, bytes: number): DfaoView {
  const { grid, cones, tiles, sizes } = bufferSizes(shape)
  const made: { destroy(): void }[] = []
  // Read when a view is made: the usage flags are the device's globals, which the modules that import this one may not have.
  const STORAGE = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  const ARGS = STORAGE | GPUBufferUsage.INDIRECT
  const buffer = (name: keyof typeof sizes, usage: number) => {
    const made1 = device.createBuffer({
      label: `${LABEL} ${name}`,
      size: Math.max(sizes[name], 16),
      usage,
    })
    made.push(made1)
    return made1
  }
  const texture = (
    name: string,
    size: readonly number[],
    format: GPUTextureFormat,
    usage: number,
  ): DfaoTexture => {
    const gpu = device.createTexture({
      label: `${LABEL} ${name}`,
      size: [Math.max(size[0], 1), Math.max(size[1], 1)],
      format,
      usage,
    })
    made.push(gpu)
    return { texture: gpu, view: gpu.createView() }
  }
  const sampled = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
  return {
    shape,
    normals: texture('normals', grid, DFAO_NORMAL_FORMAT, sampled),
    cones: texture('bent normals', cones, DFAO_BENT_FORMAT, sampled),
    history: [
      texture('history 0', grid, DFAO_BENT_FORMAT, sampled),
      texture('history 1', grid, DFAO_BENT_FORMAT, sampled),
    ],
    params: buffer('params', GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST),
    visibility: buffer('visibility', STORAGE),
    culledObjects: buffer('culledObjects', STORAGE),
    objectArgs: buffer('objectArgs', ARGS),
    tileAxis: buffer('tileAxis', STORAGE),
    tileRanges: buffer('tileRanges', STORAGE),
    tileCounts: buffer('tileCounts', STORAGE),
    tileOffsets: buffer('tileOffsets', STORAGE),
    tileData: buffer('tileData', STORAGE),
    tileArgs: buffer('tileArgs', ARGS),
    standIn: texture('stand-in', tiles, DFAO_STAND_IN_FORMAT, GPUTextureUsage.RENDER_ATTACHMENT),
    historyAt: 0,
    historyValid: false,
    lastView: undefined,
    groups: undefined,
    bytes,
    dispose: () =>
      retire(device, { destroy: () => made.forEach((resource) => resource.destroy()) }),
  }
}

/**
 * The view of `shape`: the one `held` while it is that, else made, the old one given back — made where the device's
 * budget leaves room (`ledgerRoom`, the bytes the old one gives back credited); none where it does not, and the
 * reason: the image is then lit without the occlusion.
 */
export function ensureDfaoView(
  held: DfaoView | undefined,
  device: GPUDevice,
  shape: DfaoShape,
): { view?: DfaoView; why?: string } {
  if (held && dfaoShapeKey(held.shape) === dfaoShapeKey(shape)) return { view: held }
  const replaced = held?.bytes ?? 0
  const asked = dfaoViewBytes(shape)
  if (asked - replaced > ledgerRoom(device)) {
    held?.dispose()
    return { why: 'the memory budget leaves no room for the distance-field occlusion' }
  }
  try {
    const view = ledgerTentative(device, () =>
      ledgerReplacing(device, replaced, () =>
        constructGpuResources(device, () => makeView(device, shape, asked)),
      ),
    )
    held?.dispose()
    return { view }
  } catch (error) {
    held?.dispose()
    if (budgetRefused(error))
      return { why: 'the memory budget refused the distance-field occlusion' }
    throw error
  }
}
