import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { length3 } from '../../../../math/src/vector/vector.ts'
import type { CloudPart } from '../../../../sdk-core/src/modules/sky/clouds.ts'
import { cloudShadowOfLight } from '../../../../sdk-core/src/scene/light/lightCloudShadow.ts'
import type { SceneLight } from '../../../../sdk-core/src/scene/light/contracts.ts'
import { ATMOSPHERE_SLOT } from '../../../../sdk-core/src/scene/core/atmospherePack.ts'
import { entriesIdentity } from '../../gpu/bind/entriesIdentity.ts'
import { skyStateOf } from '../../frame/render/encodeCloudsSky.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { PT_CLOUD_FLAG, PT_CLOUD_BYTES } from './cloudMediumWgsl.ts'
import { PT_CLOUD_MAP_BINDINGS } from './cloudMapWgsl.ts'
import { ledgerAdmitted } from '../../gpu/core/deviceLedger.ts'
import { volumeTablesBytes, type PathTracingGpu } from './gpuState.ts'
import type { PathTracingPipelines } from './pipelines.ts'

/** The sampled textures the finish of a bounce binds where the clouds are traced, as its layout counts them (the cut's four, the air's depth table, the light grid's two, the sky's two, the cloud material's five and the acceleration map). A device that grants fewer (`maxSampledTexturesPerShaderStage`; the engine asks for more where the adapter offers them) traces no clouds. */
export const PT_CLOUD_FINISH_TEXTURES = 15

/** Whether the device binds the textures the finish takes where the clouds are traced. */
export const grantsPathTracedClouds = (device: GPUDevice) =>
  (device.limits?.maxSampledTexturesPerShaderStage ?? 16) >= PT_CLOUD_FINISH_TEXTURES

/** The settings the traced clouds read. */
export interface PathTracingCloudSettings {
  readonly pathTracingEnableReferenceClouds: boolean
  readonly pathTracingCloudAccelerationMapResolution: number
  readonly pathTracingCloudAccelerationMapNumSamples: number
  readonly pathTracingCloudAccelerationMapVisualize: boolean
  readonly pathTracingCloudMultipleScatterMode: number
  readonly pathTracingCloudRoughnessCutoff: number
}

/** What the paths trace of the clouds in an image: the clouds part of the sky, the bindings of its material (the textures generated), and the time in seconds the material is read at. */
export interface PathTracingClouds {
  readonly part: CloudPart
  readonly entries: readonly GPUBindGroupEntry[]
  readonly time: number
}

/**
 * The clouds the paths hold, none unless the air is held (the clouds' planet is the air's; a view of the payload holds them without tracing them), the setting is on, the device binds the finish's textures (`grantsPathTracedClouds`), the sky holds a clouds part in the main view and its material's textures have landed. Each part is
 * given a number, which the run's restart compares, so that the paths start over when the clouds change.
 */
export function tracedCloudsOf(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  settings: PathTracingCloudSettings,
  air: boolean,
): PathTracingClouds | undefined {
  if (!air || !settings.pathTracingEnableReferenceClouds || !grantsPathTracedClouds(device))
    return undefined
  const sky = skyStateOf(rt)
  const entries = sky?.material?.entries
  if (!sky?.part || !entries || !sky.part.settings.inMainView) return undefined
  return { part: sky.part, entries, time: sky.clock() }
}

/** Which of the air's two lights cast the clouds' shadows (the sun and the second light): the paths shade the light that does with the clouds they trace. */
export const cloudShadowLightsOf = (store: {
  atmosphereLight(index: number): SceneLight | undefined
}): [boolean, boolean] =>
  [0, 1].map((at) => {
    const light = store.atmosphereLight(at)
    return light !== undefined && cloudShadowOfLight(light).castCloudShadows
  }) as [boolean, boolean]

const numbers = new WeakMap<object, number>()
let numbered = 0
const numberOf = (thing: object) => {
  if (!numbers.has(thing)) numbers.set(thing, ++numbered)
  return numbers.get(thing)
}
const keys = new WeakMap<readonly GPUBindGroupEntry[], { part: CloudPart; key: string }>()
/** The number of a clouds part and of each resource its material binds, the same for the same ones: a part or a texture made again restarts the accumulation, as a change of the scene's material does in the reference; the clouds' time does not (the reference's configuration holds none: the run holds one, `cloudsAtTime`). Made once for a part and its entries, which the sky replaces when they change. */
export function cloudsKey(clouds: PathTracingClouds | undefined) {
  if (!clouds) return 'none'
  const held = keys.get(clouds.entries)
  if (held?.part === clouds.part) return held.key
  const resources: unknown[] = []
  entriesIdentity(clouds.entries, resources)
  const key = [
    clouds.part,
    ...resources.filter((r): r is object => typeof r === 'object' && r !== null),
  ]
    .map(numberOf)
    .join(',')
  keys.set(clouds.entries, { part: clouds.part, key })
  return key
}

/** The clouds as the run sees them, at the time it began (`time`): the same object where the time is already that. */
export const cloudsAtTime = (clouds: PathTracingClouds | undefined, time: number | undefined) =>
  clouds && time !== undefined && clouds.time !== time ? { ...clouds, time } : clouds

/** The clip frame about the eye (the tangent basis of the up axis, the one frame that is stable as the camera turns): `up` a unit vector, the frame's right, forward and up. */
function clipFrame(up: readonly [number, number, number]) {
  const sign = up[2] >= 0 ? 1 : -1
  const a = -1 / (sign + up[2])
  const b = up[0] * up[1] * a
  return [
    [1 + sign * a * up[0] * up[0], sign * b, -sign * up[0]],
    [b, sign + a * up[1] * up[1], -up[1]],
    [up[0], up[1], up[2]],
  ] as const
}

/**
 * The clouds' block of an image (`PtCloud`): the clip frame at the eye (up from the planet's centre, which the air's block places below the point of its ground plane where the planet stands), the layer's bottom
 * and top radius (the planet's plus the part's altitude and thickness), the half side of the clip box (the farthest entry, and the march's length when it is measured from the eye) and the longest stretch, the width of
 * a texel of the map, the roughness cutoff (lifted when multiple scattering is left to the paths: mode 2), the flags and the sample the run is at.
 */
export function cloudUniform(
  clouds: PathTracingClouds,
  settings: PathTracingCloudSettings,
  packed: Float32Array,
  eye: readonly [number, number, number],
  iteration: number,
) {
  const S = ATMOSPHERE_SLOT
  const layer = clouds.part.settings
  const radiusKm = packed[S.planet * 4 + 1]!
  const centre = [
    packed[S.planetPlace * 4]!,
    packed[S.planet * 4 + 3]! - radiusKm * 1000,
    packed[S.planetPlace * 4 + 1]!,
  ] as const
  const toEye = [eye[0] - centre[0], eye[1] - centre[1], eye[2] - centre[2]] as const
  const distance = length3(toEye[0], toEye[1], toEye[2])
  const [x, y, z] = clipFrame([toEye[0] / distance, toEye[1] / distance, toEye[2] / distance])
  const bottomKm = radiusKm + layer.baseAltitudeKm
  const topKm = bottomKm + layer.thicknessKm
  const fromEye = layer.marchLengthFrom === 'eye'
  const reachKm = Math.min(layer.farthestEntryKm, fromEye ? layer.marchLengthKm : Infinity, topKm)
  const side = settings.pathTracingCloudAccelerationMapResolution
  const widthM = (2 * reachKm * 1000) / side
  const cutoff = settings.pathTracingCloudRoughnessCutoff
  const visualize = settings.pathTracingCloudAccelerationMapVisualize
  const mode = settings.pathTracingCloudMultipleScatterMode
  const floats = new Float32Array(PT_CLOUD_BYTES / 4)
  const words = new Uint32Array(floats.buffer)
  floats.set([...x, eye[0], ...y, eye[1], ...z, eye[2], ...centre, clouds.time], 0)
  floats.set([bottomKm, topKm, reachKm, distance / 1000], 16)
  floats.set(
    [
      fromEye ? 2 * reachKm * 1000 : layer.marchLengthKm * 1000,
      widthM,
      1 / widthM,
      mode === 2 && cutoff > 0 && cutoff < 1 ? 1 : cutoff,
    ],
    20,
  )
  words.set(
    [
      side,
      PT_CLOUD_FLAG.on |
        (visualize ? PT_CLOUD_FLAG.visualize : 0) |
        (mode === 1 && !visualize ? PT_CLOUD_FLAG.approximate : 0),
      settings.pathTracingCloudAccelerationMapNumSamples,
      iteration,
    ],
    24,
  )
  return floats
}

/** The side of the map the budget refused, the room it had once the held map was given back, and the bytes the map asks. */
export interface CloudMapRefusal {
  readonly side: number
  readonly room: number
  readonly missing: number
}

/** Whether a refusal of the map still holds: it was of this `side`, and the room has not grown past what it had and past what the map asks (a device allocation or free that leaves the room as it was asks nothing again). */
export const cloudRefusalHolds = (
  refusal: CloudMapRefusal | undefined,
  side: number,
  room: number,
) => refusal?.side === side && !(room > refusal.room && room >= refusal.missing)

/**
 * Makes the clouds' acceleration map `side` texels across, as the budget admits it: the images are made again in place beside the ones they replace (their bytes given back), tentatively. Returns false where
 * the budget has no room or refuses them: the old images stay whole and the run traces no clouds.
 */
export function admitCloudMap(device: GPUDevice, gpu: PathTracingGpu, side: number) {
  const held = gpu.cloudMaps[0]?.width ?? 0
  if (held === side) return true
  const freed = volumeTablesBytes(0, held)
  const admitted = ledgerAdmitted(device, {
    held: { bytes: freed, dispose: () => {} },
    asked: volumeTablesBytes(0, side),
    what: 'the path tracer’s clouds',
    make: () => gpu.setCloudMap(side),
  })
  return admitted.why === undefined
}

/**
 * The clouds' acceleration map of an image: the block written, and the kernel run once over the images of the map (made at the resolution asked, `admitCloudMap`), reading the map the sample before built (none at the first
 * sample of a run) and writing this sample's, which the trace of the image reads (`PathTracingGpu.cloudWritten`).
 */
export function encodeCloudMap(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  pipelines: PathTracingPipelines,
  gpu: PathTracingGpu,
  clouds: PathTracingClouds,
  settings: PathTracingCloudSettings,
  packed: Float32Array,
  eye: readonly [number, number, number],
  iteration: number,
) {
  const side = settings.pathTracingCloudAccelerationMapResolution
  device.queue.writeBuffer(gpu.cloud, 0, cloudUniform(clouds, settings, packed, eye, iteration))
  const read = gpu.cloudWritten
  gpu.cloudWritten = read === 0 ? 1 : 0
  const B = PT_CLOUD_MAP_BINDINGS
  const group = gpu.cloudMapGroup(
    device,
    pipelines.cloudMapLayout,
    cloudResources(gpu, clouds),
    () => [
      { binding: B.params, resource: { buffer: gpu.cloud } },
      { binding: B.previous, resource: gpu.cloudMapViews[read]! },
      { binding: B.map, resource: gpu.cloudMapViews[gpu.cloudWritten]! },
      ...shifted(clouds.entries, B.material),
    ],
  )
  const pass = encoder.beginComputePass({ label: 'Trillion3D path tracer cloud acceleration map' })
  pass.setPipeline(pipelines.cloudMap.get()!)
  pass.setBindGroup(0, group)
  pass.dispatchWorkgroups(ceilDiv(side, 8), ceilDiv(side, 8))
  pass.end()
}

/** The material's bindings (numbered from 0) moved to start at `first`. */
export const shifted = (
  entries: readonly GPUBindGroupEntry[],
  first: number,
): GPUBindGroupEntry[] => entries.map((entry) => ({ ...entry, binding: first + entry.binding }))

/** The resources the clouds' bindings name, for the identity of a group: the block, the map the sample's trace reads and the material's. */
export function cloudResources(gpu: PathTracingGpu, clouds: PathTracingClouds) {
  if (gpu.cloudNamesOf !== clouds.entries) {
    for (const names of gpu.cloudNames) {
      names.length = 2
      entriesIdentity(clouds.entries, names, 2)
    }
    gpu.cloudNamesOf = clouds.entries
  }
  return gpu.cloudNames[gpu.cloudWritten]!
}
