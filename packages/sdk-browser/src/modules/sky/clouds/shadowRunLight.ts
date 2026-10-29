import { ComputeRun } from '../../../gpu/core/lazyComputePass.ts'
import { clamp } from '../../../../../math/src/scalar/reals.ts'
import {
  cloudShadowSide,
  cloudShadowWanted,
  type CloudShadowLight,
} from '../../../../../sdk-core/src/modules/sky/cloudShadow.ts'
import {
  cloudSkyOcclusionWanted,
  type CloudSkyOcclusionLight,
} from '../../../../../sdk-core/src/modules/sky/cloudSkyOcclusion.ts'
import type { CloudPart } from '../../../../../sdk-core/src/modules/sky/clouds.ts'
import {
  writeCloudShadowBlock,
  type CloudShadowMapFrame,
  type CloudShadowSet,
} from '../../../lighting/atmosphere/cloudShadowRead.ts'
import type { UniformBlock } from '../../../gpu/core/uniformBlock.ts'
import { cloudShadowFrame } from './shadowFrame.ts'
import {
  commitCloudShadowHistory,
  createCloudShadowHistory,
  planCloudShadowTemporal,
} from './shadowHistory.ts'
import {
  viewOf,
  type createCloudShadowEncoders,
  type createCloudShadowSlots,
} from './shadowRunPasses.ts'
import {
  cloudShadowSizes,
  writeCloudShadowTemporal,
  writeCloudShadowTrace,
} from './shadowLayout.ts'
import type { createSkyOcclusionRun } from './skyOcclusionRun.ts'

/**
 * ONE IMAGE OF THE CLOUD SHADOW MAPS (`shadowRun.ts` holds what they live in): the map of each light
 * that casts cloud shadows (`encodeLight`: the trace, the temporal filter, the spatial filters) and
 * the set the lookups read (`encodeCloudShadows`), the sky occlusion map among them where the sky
 * light asks for it.
 */

/** The air's light, as the clouds know it: its settings, and the unit direction toward it. */
export interface CloudShadowLightInput {
  readonly light: CloudShadowLight
  readonly toward: readonly [number, number, number]
}

/** What an image tells the shadow maps. */
export interface CloudShadowRunInput {
  readonly part: CloudPart
  /** The air's two lights; none for a light the air does not have. */
  readonly lights: readonly [CloudShadowLightInput | undefined, CloudShadowLightInput | undefined]
  /** The camera in the scene, metres, and from the planet's centre, kilometres. */
  readonly eye: ArrayLike<number>
  readonly eyeFromPlanetKm: ArrayLike<number>
  readonly planetRadiusKm: number
  readonly time: number
  readonly frameIndex: number
  /** The material's seven bindings of the trace's group, from `B.material`. */
  readonly material: readonly GPUBindGroupEntry[]
  /** The light buffer and the air's frame buffer, the trace's group 0. */
  readonly air: { readonly buffer: GPUBuffer; readonly frame: GPUBuffer }
  /** The view keeps state from one image to the next. */
  readonly keepsState: boolean
  /** The sky light's settings the sky occlusion map reads; none where the scene has no sky light
   *  that affects the world. */
  readonly skyLight?: CloudSkyOcclusionLight
}

/** What an image of the maps is made with, held by the run (`createCloudShadowRun`). */
export interface CloudShadowParts {
  readonly device: GPUDevice
  readonly passes: ReturnType<typeof createCloudShadowEncoders>
  readonly occlusion: ReturnType<typeof createSkyOcclusionRun>
  readonly slots: ReturnType<typeof createCloudShadowSlots>['slots']
  readonly slotFor: ReturnType<typeof createCloudShadowSlots>['slotFor']
  readonly release: (k: number) => void
  readonly lookup: GPUSampler
  /** The lookups' block and the stand-in map of a light that has none. */
  readonly block: UniformBlock
  readonly none: GPUTextureView
  /** The words the other blocks are written from, reused. */
  readonly trace: Float32Array<ArrayBuffer>
  readonly blend: Float32Array<ArrayBuffer>
}

/** Light `k`'s map of the image, encoded; what the lookups need of it and the map to read. */
function encodeLight(
  parts: CloudShadowParts,
  k: number,
  input: CloudShadowRunInput,
  light: CloudShadowLightInput,
): CloudShadowMapFrame & { final: GPUTextureView } {
  const { device, passes, slots, slotFor, trace, blend } = parts
  const { quality } = input.part
  const side = cloudShadowSide(light.light, quality.cloudShadowMapResolutionMax)
  const frame = cloudShadowFrame({
    eye: input.eye,
    eyeFromPlanetKm: input.eyeFromPlanetKm,
    planetRadiusKm: input.planetRadiusKm,
    toward: light.toward,
    side,
    light: light.light,
    quality,
  })
  const weight = clamp(quality.cloudShadowMapNewFrameWeight, 0, 1)
  const spatial = clamp(quality.cloudShadowMapSpatialFiltering, 0, 4)
  const kept = weight < 1 && input.keepsState
  const temporal = planCloudShadowTemporal(
    frame,
    side,
    weight,
    kept ? (slots[k]?.history ?? createCloudShadowHistory()) : undefined,
    input.frameIndex,
    quality.cloudShadowMapLightRotationCutDegrees,
  )
  const slot = slotFor(k, cloudShadowSizes(side, spatial, temporal), temporal.filtered)
  writeCloudShadowTrace(
    trace,
    { frame, side, temporal, time: input.time, planetRadiusKm: input.planetRadiusKm },
    light.light,
    input.part,
  )
  device.queue.writeBuffer(slot.trace, 0, trace)
  const pass = shadowSteps.pass(SHADOW_PASS)
  passes.trace(pass, slot, input, temporal.tracedSide)
  if (temporal.filtered) {
    writeCloudShadowTemporal(blend, frame, side, weight, temporal)
    device.queue.writeBuffer(slot.blend, 0, blend)
    passes.blend(pass, slot, side)
  }
  for (let i = temporal.filtered ? 1 : 0; i < slot.textures.length - 1; i++) {
    const source = i === 1 && temporal.filtered ? slot.whole[slot.current] : slot.textures[i]
    passes.filter(pass, slot, source, i)
  }
  commitCloudShadowHistory(slot.history, frame, side, temporal.filtered)
  const last = temporal.filtered && spatial === 0 ? slot.whole[slot.current] : slot.textures.at(-1)!
  return {
    clipFromCamera: frame.clipFromCamera,
    cameraFromClip: frame.cameraFromClip,
    rayDirection: frame.rayDirection,
    samples: frame.samples,
    side: last.width,
    farDepthKm: frame.farDepthKm,
    surfaceStrength: light.light.cloudShadowOnSurfaceStrength,
    airStrength: light.light.cloudShadowOnAtmosphereStrength,
    final: viewOf(slot, last),
  }
}

const SHADOW_PASS: GPUComputePassDescriptor = { label: 'Trillion3D cloud shadow' }
/** The image's maps, each light's and the sky occlusion's, one compute pass but on a frame timed per pass. */
const shadowSteps = new ComputeRun()

/** The maps of this image on `encoder`, for the lookups; the stand-in where a light has none, and
 *  for the sky occlusion where the sky light does not ask for it. */
export function encodeCloudShadows(
  parts: CloudShadowParts,
  encoder: GPUCommandEncoder,
  input: CloudShadowRunInput,
): CloudShadowSet {
  const { occlusion, none } = parts
  shadowSteps.begin(encoder)
  const maps = input.lights.map((light, k) => {
    if (light && cloudShadowWanted(input.part.quality, light.light))
      return encodeLight(parts, k, input, light)
    parts.release(k)
    return undefined
  })
  const frames = maps as [CloudShadowMapFrame | undefined, CloudShadowMapFrame | undefined]
  const { skyLight } = input
  const sky =
    skyLight && cloudSkyOcclusionWanted(input.part.quality, skyLight)
      ? occlusion.encode(shadowSteps, input, skyLight)
      : undefined
  shadowSteps.end()
  if (!sky) occlusion.release()
  writeCloudShadowBlock(parts.block.words.f, frames, input.eye, sky?.frame)
  parts.block.send()
  return {
    maps: [maps[0]?.final ?? none, maps[1]?.final ?? none],
    ao: sky?.view ?? none,
    skyFrame: sky?.frame,
    sampler: parts.lookup,
    block: parts.block.buffer,
    frames,
    camera: input.eye,
  }
}
