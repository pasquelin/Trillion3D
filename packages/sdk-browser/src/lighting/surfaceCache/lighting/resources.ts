import { ledgerAdmitted } from '../../../gpu/core/deviceLedger.ts'
import { retire } from '../../../gpu/core/frameRetire.ts'
import {
  countingAllocator,
  gpuAllocator,
  type ResourceAllocator,
} from '../../../gpu/core/resourceAllocator.ts'
import { SURFACE_CACHE_ATLAS_LABEL } from '../../../diagnostic/stage/passLabels.ts'
import { LIGHTING_PARAMS } from './layout.ts'
import { type LightingShape, shapeKey, sizesOf } from './params.ts'

/**
 * THE LIGHTING'S OWN MEMORY, made for a shape (`shapeOf`) and again when it changes: the parameters' uniform, the update
 * context (the header and the lists of tiles: it is the dispatches' arguments too), the lights of each tile, the
 * radiosity's rays filtered, and the two atlases the radiosity keeps from one image to the next — the rays' radiance for each probe
 * (`trace`, the words of light, a square of rays a probe) and the probes' harmonics (`harmonics`, a layer a channel). They are
 * asked of the device's budget as the atlases are (`ensureLighting`): where it refuses, the lighting is off and says why.
 */

/** The lighting's resources of one shape. */
export interface LightingResources {
  readonly key: string
  readonly params: GPUBuffer
  readonly context: GPUBuffer
  readonly tileLights: GPUBuffer
  readonly filtered: GPUBuffer
  readonly trace: GPUTextureView
  readonly harmonics: GPUTextureView
  readonly bytes: number
  dispose(): void
}

/** The resources of `shape`, asked of `allocator`. */
function allocate(allocator: ResourceAllocator, shape: LightingShape) {
  const sizes = sizesOf(shape)
  const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING
  return {
    params: allocator.buffer('lighting parameters', LIGHTING_PARAMS.words, 'uniform'),
    context: allocator.buffer('lighting context', sizes.context.words, 'list'),
    tileLights: allocator.buffer('lights of the tiles', sizes.tileLightsWords, 'storage'),
    filtered: allocator.buffer('filtered radiosity rays', sizes.filteredWords, 'storage'),
    trace: allocator.texture('radiosity trace', [sizes.traceAtlas, sizes.traceAtlas], 'r32uint', {
      usage,
    }),
    harmonics: allocator.texture(
      'radiosity harmonics',
      [sizes.probeAtlas, sizes.probeAtlas, 3],
      'rgba16float',
      { usage },
    ),
  }
}

/** The bytes the resources of `shape` hold. */
function lightingBytes(shape: LightingShape) {
  const counting = countingAllocator()
  allocate(counting, shape)
  return counting.bytes()
}

function makeLighting(device: GPUDevice, shape: LightingShape, bytes: number): LightingResources {
  const allocator = gpuAllocator(device, `${SURFACE_CACHE_ATLAS_LABEL} lighting`)
  return {
    key: shapeKey(shape),
    ...allocate(allocator, shape),
    bytes,
    dispose: () => retire(device, { destroy: () => allocator.destroy() }),
  }
}

/**
 * The lighting's resources for `shape`: `held` where they are for it, else made, those held given back — where the device's
 * budget leaves room (`ledgerAdmitted`); none where it does not, with the reason.
 */
export function ensureLighting(
  held: LightingResources | undefined,
  device: GPUDevice,
  shape: LightingShape,
): { resources?: LightingResources; why?: string } {
  if (held?.key === shapeKey(shape)) return { resources: held }
  const bytes = lightingBytes(shape)
  const { value, why } = ledgerAdmitted(device, {
    held,
    asked: bytes,
    what: 'the surface cache lighting',
    make: () => makeLighting(device, shape, bytes),
  })
  return { resources: value, why }
}
