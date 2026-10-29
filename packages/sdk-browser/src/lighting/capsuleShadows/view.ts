import { alignUp, nextPow2 } from '../../../../math/src/scalar/integers.ts'
import { shapeView } from '../../gpu/core/shapeView.ts'
import { textureBytesOf } from '../../gpu/core/textureBytes.ts'
import { viewResources, type ViewTexture } from '../distanceField/viewResources.ts'
import {
  CAPSULE_BENT_NORMAL_FORMAT,
  CAPSULE_FACTORS_FORMAT,
  CAPSULE_PARAM_BYTES,
  LIGHT_DIRECTION_PARAM_FLOATS,
  UPSAMPLE_PARAM_BYTES,
} from './layout.ts'
import { capsuleFactorsSize, capsuleGrid } from './plan.ts'
import { CAPSULE_SHAPE_FLOATS, LIGHT_DIRECTION_WORDS } from './shapes.ts'

const LABEL = 'Trillion3D capsule shadows'

/** The passes of an image a view has room for: one for each light that casts capsule shadows, then the indirect and the sky light's. */
export const CAPSULE_SLOTS = 16

/** The alignment of a window of a buffer a bind group names. */
const ALIGN = 256
const aligned = (bytes: number) => alignUp(bytes, ALIGN)

/**
 * What decides the size of a view's resources: the image's extent and the factors' downsample, the shapes, the light records and the
 * distance-field casters a pass has room for (rounded up to a power of two, only growing), and the size of the bent normal the sky light's pass
 * writes (none until it is asked).
 */
export interface CapsuleShape {
  extent: readonly [number, number]
  downsample: number
  shapes: number
  records: number
  casters: number
  bent: readonly [number, number] | undefined
}

/** The room a count asks, a power of two of at least 64. */
export const capsuleRoom = (count: number) => nextPow2(Math.max(count, 64))

const shapeKey = (s: CapsuleShape) =>
  `${s.extent}|${s.downsample}|${s.shapes}|${s.records}|${s.casters}|${s.bent ?? ''}`

/**
 * A VIEW'S CAPSULE SHADOW RESOURCES: the shadow factors (a texture at a fraction of the image) and the tiles' counts, the windows of the
 * shapes, light records and casters each pass of an image writes (one window a pass, so the passes of an image do not overwrite one
 * another's data before the commands run), the passes' uniforms, the light directions the GPU derives, and the bent normal the sky light's pass
 * writes. Held on the frame's state and counted in its bytes.
 */
export interface CapsuleView {
  readonly shape: CapsuleShape
  readonly factors: ViewTexture
  readonly tileCounts: GPUBuffer
  readonly params: GPUBuffer
  readonly upsampleParams: GPUBuffer
  readonly shapes: GPUBuffer
  readonly lights: GPUBuffer
  readonly derivedLights: GPUBuffer
  readonly directionParams: GPUBuffer
  readonly casters: GPUBuffer
  readonly bent: ViewTexture | undefined
  /** The windows' sizes in bytes. */
  readonly window: { readonly shapes: number; readonly lights: number; readonly casters: number }
  /** The bind groups the passes were made over, kept while what they name is the same (`frame.ts`). */
  groups: Map<string, unknown>
  readonly bytes: number
  dispose(): void
}

/** The factors' size: the image's extent over the downsample. */
const factorsExtent = (shape: CapsuleShape) => capsuleFactorsSize(shape.extent, shape.downsample)

/** The sizes in bytes of the view's buffers, by name. */
function bufferSizes(shape: CapsuleShape) {
  const grid = capsuleGrid(shape.extent, shape.downsample, false)
  const tiles = grid.tilesAcross * grid.tilesDown
  return {
    tileCounts: tiles * 4,
    params: CAPSULE_SLOTS * aligned(CAPSULE_PARAM_BYTES),
    upsampleParams: CAPSULE_SLOTS * aligned(UPSAMPLE_PARAM_BYTES),
    shapes: CAPSULE_SLOTS * aligned(shape.shapes * CAPSULE_SHAPE_FLOATS * 4),
    lights: CAPSULE_SLOTS * aligned(shape.records * LIGHT_DIRECTION_WORDS * 4),
    derivedLights: CAPSULE_SLOTS * aligned(shape.records * LIGHT_DIRECTION_WORDS * 4),
    directionParams: CAPSULE_SLOTS * aligned(LIGHT_DIRECTION_PARAM_FLOATS * 4),
    casters: CAPSULE_SLOTS * aligned(shape.casters * 4),
  }
}

function capsuleViewBytes(shape: CapsuleShape) {
  const texture = (size: readonly number[], format: GPUTextureFormat) =>
    textureBytesOf({ size: [size[0], size[1]], format }) ?? 0
  return (
    Object.values(bufferSizes(shape)).reduce((sum, bytes) => sum + bytes, 0) +
    texture(factorsExtent(shape), CAPSULE_FACTORS_FORMAT) +
    (shape.bent ? texture(shape.bent, CAPSULE_BENT_NORMAL_FORMAT) : 0)
  )
}

function makeView(device: GPUDevice, shape: CapsuleShape, bytes: number): CapsuleView {
  const sizes = bufferSizes(shape)
  const { sized: buffer, texture, dispose } = viewResources(device, LABEL, sizes)
  const STORAGE = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  const UNIFORM = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  return {
    shape,
    factors: texture(
      'factors',
      factorsExtent(shape),
      CAPSULE_FACTORS_FORMAT,
      GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    ),
    tileCounts: buffer('tileCounts', STORAGE),
    params: buffer('params', UNIFORM),
    upsampleParams: buffer('upsampleParams', UNIFORM),
    shapes: buffer('shapes', STORAGE),
    lights: buffer('lights', STORAGE),
    derivedLights: buffer('derivedLights', STORAGE),
    directionParams: buffer('directionParams', UNIFORM),
    casters: buffer('casters', STORAGE),
    bent: shape.bent
      ? texture(
          'bent normal',
          shape.bent,
          CAPSULE_BENT_NORMAL_FORMAT,
          GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
        )
      : undefined,
    window: {
      shapes: aligned(shape.shapes * CAPSULE_SHAPE_FLOATS * 4),
      lights: aligned(shape.records * LIGHT_DIRECTION_WORDS * 4),
      casters: aligned(shape.casters * 4),
    },
    groups: new Map(),
    bytes,
    dispose,
  }
}

/** The byte offsets of the windows of a slot: the uniforms' blocks are one stride a slot. */
export const slotOffsets = (view: CapsuleView, slot: number) => ({
  params: slot * aligned(CAPSULE_PARAM_BYTES),
  upsampleParams: slot * aligned(UPSAMPLE_PARAM_BYTES),
  shapes: slot * view.window.shapes,
  lights: slot * view.window.lights,
  casters: slot * view.window.casters,
  directionParams: slot * aligned(LIGHT_DIRECTION_PARAM_FLOATS * 4),
})

/** The binding of the window of a buffer of `size` bytes at `offset`. */
export const windowOf = (buffer: GPUBuffer, offset: number, size: number): GPUBufferBinding => ({
  buffer,
  offset,
  size,
})

/** The blocks' sizes the uniforms are bound at. */
export const BLOCK_BYTES = {
  params: CAPSULE_PARAM_BYTES,
  upsampleParams: UPSAMPLE_PARAM_BYTES,
} as const

/**
 * The view of `shape`: the one `held` while it is that, else made, the old one given back — made where the device's budget leaves room; none where
 * it does not, and the reason: the image is then lit without the capsule shadows.
 */
export function ensureCapsuleView(
  held: CapsuleView | undefined,
  device: GPUDevice,
  shape: CapsuleShape,
): { view?: CapsuleView; why?: string } {
  return shapeView(held, device, {
    same: held !== undefined && shapeKey(held.shape) === shapeKey(shape),
    what: 'the capsule shadows',
    bytes: () => capsuleViewBytes(shape),
    make: (asked) => makeView(device, shape, asked),
  })
}
