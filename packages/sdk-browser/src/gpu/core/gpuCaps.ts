import { adapterKey } from '../../../../sdk-core/src/runtime/hardwareBenchmark.ts'
import type { TextureBlockFormat } from '../../../../sdk-core/src/texture/previewFormat.ts'
import { addressParam } from '../../session/host/addressFlag.ts'

/**
 * WHAT A WEBGPU DEVICE CAN DO, read once and held: the one place that asks a device's `features`
 * and its adapter's information. Every kernel that has a native form (a subgroup vote, a 16-bit
 * float, a 64-bit atomic…) and a form written without it (workgroup memory, 32 bits, two phases…)
 * asks the record (`gpuCapsOf`) and takes its branch from `nativeOrPolyfill`, which names the
 * branch for the pipeline label and the GPU log; both branches give the one result. The session
 * asks the device for these features when its adapter has them (`../../session/gpuDevice.ts`).
 *
 * The host test switch `trillion3dGpuFeaturesOff=subgroups,shader-f16` of the page's address
 * (`gpuFeaturesOff`) names features off: the record holds them absent, so every mechanism that
 * depends on one takes its polyfill — the proof, on a machine that has them, of each variant
 * written without them. A feature named off also takes off the ones it carries
 * (§ 3.6.1.2 "Feature Dependencies" of the specification, https://www.w3.org/TR/webgpu/#feature-dependencies).
 */

/** The WebGPU feature each capability reads. The installed type list of `GPUFeatureName` may
 *  predate some of the names. */
const featureName = (name: string) => name as GPUFeatureName
export const FEATURE = {
  indirectFirstInstance: featureName('indirect-first-instance'),
  timestamp: featureName('timestamp-query'),
  subgroups: featureName('subgroups'),
  subgroupSizeControl: featureName('subgroup-size-control'),
  f16: featureName('shader-f16'),
  depthClipControl: featureName('depth-clip-control'),
  clipDistances: featureName('clip-distances'),
  dualSource: featureName('dual-source-blending'),
  float32Filterable: featureName('float32-filterable'),
  float32Blendable: featureName('float32-blendable'),
  textureTier1: featureName('texture-formats-tier1'),
  wideAtomics: featureName('atomic-vec2u-min-max'),
  textureTier2: featureName('texture-formats-tier2'),
  rg11b10Renderable: featureName('rg11b10ufloat-renderable'),
}

/** The WebGPU feature that unlocks each block-compressed family. */
export const BLOCK_FEATURES: Record<TextureBlockFormat, GPUFeatureName> = {
  bc7: 'texture-compression-bc',
  astc: 'texture-compression-astc',
  etc2: 'texture-compression-etc2',
}

/** Every optional feature the engine can use, in the order the session asks the device for them (the order of `FEATURE`, then the
 *  block-compressed families): the one list, from which the device's request and the features it publishes are made. */
export const OPTIONAL_GPU_FEATURES: readonly GPUFeatureName[] = [
  ...Object.values(FEATURE),
  ...Object.values(BLOCK_FEATURES),
]

/** The features that carry another (§ 3.6.1.2 "Feature Dependencies"): a device created with one
 *  enables the other with it, so one named off takes the features that carry it off too. */
const CARRIED_BY: Readonly<Record<string, GPUFeatureName>> = {
  [FEATURE.subgroupSizeControl]: FEATURE.subgroups,
  [FEATURE.textureTier2]: FEATURE.textureTier1,
}

/** The features the address's test switch names off (`trillion3dGpuFeaturesOff`), as written. */
const featuresOffIn = (params: URLSearchParams) =>
  params.get('trillion3dGpuFeaturesOff')?.split(',') ?? []
/** Those of the page's address, read through the one address reader (`addressParam`). */
export const gpuFeaturesOff = addressParam(featuresOffIn, [] as string[])

/** Whether `feature` is named off in `off`, or carried by one that is. */
export function isForcedOff(off: readonly string[], feature: string) {
  const named = (name: string) => off.some((entry) => entry.trim() === name)
  return named(feature) || (feature in CARRIED_BY && named(CARRIED_BY[feature]))
}

/** The record of what a device can do (`gpuCapsOf`). */
export interface GpuCaps {
  /** The `subgroups` feature: whether it is granted, the least and the greatest subgroup size
   *  the adapter states (0 where it states none) and the control of the size
   *  (`subgroup-size-control`). */
  readonly subgroups: {
    readonly present: boolean
    readonly minLanes: number
    readonly maxLanes: number
    readonly sizeControl: boolean
  }
  /** 16-bit shader floats (`shader-f16`). */
  readonly f16: boolean
  /** 32-bit float textures sampled through a filter (`float32-filterable`). */
  readonly float32Filterable: boolean
  /** Blending into 32-bit float targets (`float32-blendable`). */
  readonly float32Blendable: boolean
  /** The 64-bit atomic maximum (`atomic-vec2u-min-max`). */
  readonly wideAtomics: boolean
  /** Render targets of the packed 11-11-10 float format (`rg11b10ufloat-renderable`). */
  readonly rg11b10Renderable: boolean
  /** The storage textures of the packed 8-bit and 11-11-10 formats (`texture-formats-tier1`: 1)
   *  and the read-write ones of the 8-bit formats (`texture-formats-tier2`: 2); 0 with none. */
  readonly textureTier: 0 | 1 | 2
  /** The block-compressed families the device samples. */
  readonly blockFormats: Readonly<Record<TextureBlockFormat, boolean>>
  /** GPU timestamp queries (`timestamp-query`). */
  readonly timestamp: boolean
  /** Dual-source blending (`dual-source-blending`). */
  readonly dualSource: boolean
  /** Clip distances in the vertex stage (`clip-distances`). */
  readonly clipDistances: boolean
  /** The adapter the device runs on, as its key (`adapterKey`); `undefined` where the device states none: no key stands for an
   *  adapter that is not known, for it would be every unknown adapter's. */
  readonly adapter: string | undefined
}

/** What a device states of its adapter: its identity and, where it states them, its subgroup sizes. */
interface AdapterStated {
  readonly vendor?: string
  readonly architecture?: string
  readonly device?: string
  readonly description?: string
  readonly subgroupMinSize?: number
  readonly subgroupMaxSize?: number
}
type FeatureSet = { has(name: string): boolean }

/** What a record is read from: a device, or anything that states the same. */
export interface CapsSource {
  readonly features?: FeatureSet
  readonly adapterInfo?: AdapterStated
}

/** The record of a device with `features` and `adapterInfo`, the features named off in `off`
 *  absent. */
export function gpuCapsFrom(
  features: FeatureSet,
  adapterInfo: AdapterStated | undefined,
  off: readonly string[],
): GpuCaps {
  const has = (feature: string) => features.has(feature) && !isForcedOff(off, feature)
  const textureTier: GpuCaps['textureTier'] = has(FEATURE.textureTier2)
    ? 2
    : has(FEATURE.textureTier1)
      ? 1
      : 0
  return Object.freeze({
    subgroups: Object.freeze({
      present: has(FEATURE.subgroups),
      minLanes: adapterInfo?.subgroupMinSize ?? 0,
      maxLanes: adapterInfo?.subgroupMaxSize ?? 0,
      sizeControl: has(FEATURE.subgroupSizeControl),
    }),
    f16: has(FEATURE.f16),
    float32Filterable: has(FEATURE.float32Filterable),
    float32Blendable: has(FEATURE.float32Blendable),
    wideAtomics: has(FEATURE.wideAtomics),
    rg11b10Renderable: has(FEATURE.rg11b10Renderable),
    textureTier,
    blockFormats: Object.freeze({
      bc7: has(BLOCK_FEATURES.bc7),
      astc: has(BLOCK_FEATURES.astc),
      etc2: has(BLOCK_FEATURES.etc2),
    }),
    timestamp: has(FEATURE.timestamp),
    dualSource: has(FEATURE.dualSource),
    clipDistances: has(FEATURE.clipDistances),
    adapter: adapterInfo
      ? adapterKey({
          vendor: adapterInfo.vendor ?? '',
          architecture: adapterInfo.architecture ?? '',
          device: adapterInfo.device ?? '',
          description: adapterInfo.description ?? '',
        })
      : undefined,
  })
}

const NO_FEATURES: FeatureSet = { has: () => false }
/** The record of each device, and of each feature set read alone: each made at its first ask, the address's switch read then —
 *  it applies to the devices the session creates (`requestExplorerDevice`) —, and held. Two maps, so that the record of an object
 *  never depends on which of the two readers asked first. */
const ofDevices = new WeakMap<object, GpuCaps>()
const ofFeatureSets = new WeakMap<object, GpuCaps>()

function held(
  records: WeakMap<object, GpuCaps>,
  key: object,
  features: FeatureSet | undefined,
  info: AdapterStated | undefined,
) {
  let caps = records.get(key)
  if (!caps) records.set(key, (caps = gpuCapsFrom(features ?? NO_FEATURES, info, gpuFeaturesOff())))
  return caps
}

/** The record of `device`, read at the first ask (`gpuCapsFrom`) and held. */
export const gpuCapsOf = (device: CapsSource) =>
  held(ofDevices, device, device.features, device.adapterInfo)

/** The record of a device's `features` alone, its subgroup sizes and adapter not stated: for a
 *  reader that is handed the features (an adapter's, a device's) and nothing else. */
export const gpuCapsOfFeatures = (features: FeatureSet) =>
  held(ofFeatureSets, features, features, undefined)

/** The optional features `device` was granted, in request order (`OPTIONAL_GPU_FEATURES`): what the session publishes. */
export const grantedGpuFeatures = (device: CapsSource) =>
  OPTIONAL_GPU_FEATURES.filter((feature) => device.features?.has(feature))

/** Whether `features`, a device's, hold 32-bit float textures read through a filter
 *  (`float32-filterable`): a reader that samples a single-float texture through a filtering sampler
 *  keeps half floats on a device that lacks it. */
export const hasFloat32Filterable = (features: FeatureSet) =>
  gpuCapsOfFeatures(features).float32Filterable

/** The mechanisms that have a native form and a polyfill, each with what makes it native. */
const NATIVE_WHEN = {
  subgroups: (caps: GpuCaps) => caps.subgroups.present,
  f16: (caps: GpuCaps) => caps.f16,
  float32Filterable: (caps: GpuCaps) => caps.float32Filterable,
  float32Blendable: (caps: GpuCaps) => caps.float32Blendable,
  wideAtomics: (caps: GpuCaps) => caps.wideAtomics,
  textureTier1: (caps: GpuCaps) => caps.textureTier >= 1,
  textureTier2: (caps: GpuCaps) => caps.textureTier >= 2,
  clipDistances: (caps: GpuCaps) => caps.clipDistances,
  dualSource: (caps: GpuCaps) => caps.dualSource,
}
export type Mechanism = keyof typeof NATIVE_WHEN

/** Which branch `mechanism` takes on a device of `caps`: `native` where the device has the feature
 *  it is written with, else its polyfill; `tag` names the branch for a pipeline label and the GPU
 *  log (`subgroups native`). */
export function nativeOrPolyfill(caps: GpuCaps, mechanism: Mechanism) {
  const native = NATIVE_WHEN[mechanism](caps)
  return { native, tag: `${mechanism} ${native ? 'native' : 'polyfill'}` }
}

/** Every mechanism's branch on a device of `caps`, in the order above: the GPU log's one line. */
export const branchTags = (caps: GpuCaps) =>
  (Object.keys(NATIVE_WHEN) as Mechanism[])
    .map((mechanism) => nativeOrPolyfill(caps, mechanism).tag)
    .join(', ')
