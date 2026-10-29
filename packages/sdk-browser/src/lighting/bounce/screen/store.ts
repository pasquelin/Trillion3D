import { hasSubgroups, hasSubgroupsOf, uniformSubgroupLanes } from '../../../gpu/core/subgroups.ts'
import {
  MARCH_VIRTUAL_LANES,
  type MarchLanes,
} from '../../../visibility/hiz/gpu/screenMarchLanes.ts'
import { settingsWatch } from '../../../../../sdk-core/src/contracts/settingRules.ts'
import {
  LIGHTING_DATA_FORMAT_RULES,
  type LightingDataFormatOptions,
} from '../../../../../sdk-core/src/contracts/lightingDataFormatOptions.ts'
import {
  SCREEN_PROBE_RULES,
  resolveScreenProbes,
  type ScreenProbeOptions,
  type ScreenProbeSettings,
} from '../../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import type { ScreenProbeFrameMetrics } from '../../../../../sdk-core/src/contracts/shadowMetrics.ts'
import type { LightAtlasFormat } from '../../../gpu/core/lightAtlasFormat.ts'
import { groupWidth } from '../../../gpu/dispatch/grid.ts'
import { track } from '../../deferred/compileLedger.ts'
import type { ScreenProbeInputs } from './groupParts.ts'
import type { FieldOcclusion } from './occlusionOnly.ts'
import {
  meshStageKernel,
  newMeshStageState,
  type MeshStageKernel,
  type MeshStageState,
} from './meshStage.ts'
import { createStandIns, type NoCache } from './standIns.ts'
import { startedScreenStage, type ScreenProbeStage, type StartedScreenStage } from './stage.ts'
import {
  compileScreenProbeKernels,
  convertWorkgroupBytes,
  kernelShapeOf,
  mipLevelOf,
  occlusionSource,
  raysKey,
  screenProbeSources,
  shapeKey,
  type Kernel,
  type KernelShape,
  type KernelSource,
  type ScreenProbeKernels,
  type TracedSceneKernel,
  tracedSceneKernel,
} from './kernels.ts'

/** The subgroup sizes the conversion's projection is summed by, where every subgroup of the device holds as many lanes (`screenProbeFilteringWaveOps`). */
const WAVE_LANES = [32, 64] as const

/** How the screen trace counts the lanes still marching (`screenMarchLanes.ts`) for a shape on `device`: not at all where the shape asks no minimum occupancy; by the
 *  subgroups where every one holds 32 lanes; else by the workgroup's memory, over virtual subgroups of 32, which a group of rays of fewer or of a number not a multiple of 32 has none of
 *  (the tracing at 4 rays a side): no minimum then. */
const marchOf = (device: GPUDevice, shape: KernelShape): MarchLanes => {
  if (!shape.occupancy || !shape.hierarchical) return 'none'
  if (hasSubgroupsOf(device, MARCH_VIRTUAL_LANES)) return 'native'
  return (shape.side * shape.side) % MARCH_VIRTUAL_LANES === 0 ? 'polyfill' : 'none'
}

/** The lanes of the subgroups the conversion sums its projection by on `device`: none where the shape does not ask it, where the device has no subgroups of 32 or 64 lanes, or where
 *  the sums' partial sums would take its workgroup memory past what the device grants (the serial sums then). */
const waveLanesOf = (device: GPUDevice, shape: KernelShape) => {
  const lanes = shape.waveOps ? (uniformSubgroupLanes(device, WAVE_LANES) ?? 0) : 0
  const fits =
    convertWorkgroupBytes(shape.gather, shape.extraAo, lanes) <=
    device.limits.maxComputeWorkgroupStorageSize
  return fits ? lanes : 0
}

/** A kernel in the making or made: `kernel` once the device has handed its pipelines back. */
interface KernelEntry {
  kernel?: Kernel<string>
}

/** What a settings object asks of the kernels, once: their shape and the key two shapes that agree share a set by. */
interface ShapeOf {
  shape: KernelShape
  key: string
  /** The key two shapes that cast the scene stage through the scene's triangles with the same rays a side, samples of a tile and fog on the rays share a kernel by. */
  tracedKey: string
  /** The sources of its kernels, written once and kept until the set is made. */
  sources?: [string, KernelSource<string>][]
  /** The same shape for a radiance cache stored in another format, by the format (`ScreenProbeStore.kernelsFor`). */
  byLight?: Map<LightAtlasFormat, ShapeOf>
}

/** The state the screen probes keep for a device: the settings' watch, the kernels (each compiled once for what its code depends
 *  on, off the frame, the image drawn without the probes while they compile), what the last image counted and the surfaces'
 *  stand-in. */
export interface ScreenProbeStore {
  /** Why the probes could not be made, when they could not. */
  reason: string | null
  /** What the last image counted (`BounceFrameMetrics.screen`), none while none was drawn. */
  metrics: ScreenProbeFrameMetrics | undefined
  /** The settings `options` hold, read again at each image and resolved only where a value moved. */
  read(options: ScreenProbeOptions & LightingDataFormatOptions): ScreenProbeSettings
  /** The kernels `settings` need on `device`, asked of it off the frame, for a radiance cache whose final maps are stored in the format `light`: none while any is compiling or refused. */
  kernelsFor(
    device: GPUDevice,
    settings: ScreenProbeSettings,
    light: LightAtlasFormat,
  ): ScreenProbeKernels | undefined
  /** The kernel that casts the scene stage of `settings` through the scene's triangles on `device`, compiled off the frame on the first ask:
   *  read once `ready`. */
  tracedFor(
    device: GPUDevice,
    settings: ScreenProbeSettings,
    light: LightAtlasFormat,
  ): TracedSceneKernel
  /** The kernel of the meshes' fields stage (`traceMeshes`) for the rays of `settings` on `device`, compiled off the frame on the first ask: read once `ready`. */
  meshesFor(
    device: GPUDevice,
    settings: ScreenProbeSettings,
    kernels: ScreenProbeKernels,
  ): MeshStageKernel
  /** What the meshes' stage keeps between two images (the grid's resources and its group). */
  meshes: MeshStageState
  /** The kernel of a stage a pass of the frame adds to the probes' pass (`ScreenProbeStage`) for the probes of `settings`, compiled off the frame on the first ask: read once `ready`. */
  stageFor(
    device: GPUDevice,
    settings: ScreenProbeSettings,
    kernels: ScreenProbeKernels,
    stage: ScreenProbeStage,
  ): StartedScreenStage
  /** The kernel of the short-range occlusion alone for the probes of `settings` on `device`, compiled off the frame on the first ask (the irradiance field's pass: none of the probes' other kernels is
   *  made for it): none while it compiles or if the device refused it. */
  occlusionFor(device: GPUDevice, settings: ScreenProbeSettings): Kernel<'occlusion'> | undefined
  /** The irradiance field's short-range occlusion, its parameters and its texture, once an image searched it (`encodeFieldOcclusion`). */
  fieldOcclusion: FieldOcclusion | undefined
  /** What the groups name of the image being cast, written over at each image (`inputsOf`, `frame.ts`): none before the first. */
  inputs: ScreenProbeInputs | undefined
  /** What the kernels bind for the surfaces' vectors where the image drew none: a texel of zero. */
  noVectors(device: GPUDevice): GPUTextureView
  /** What the kernels bind for the radiance cache where there is none: texels of zero. */
  noCache(device: GPUDevice, light: LightAtlasFormat): NoCache
  /** What the kernels bind for the poses of the cut where the image holds none: a texel of zero. */
  noPoses(device: GPUDevice): GPUTextureView
  dispose(): void
}

/** The kernels the store keeps, each by its key. */
function createKernelCaches() {
  const caches = {
    kernels: new Map<string, KernelEntry>(),
    sets: new Map<string, ScreenProbeKernels>(),
    /** The kernels that cast the scene stage through the scene's triangles, made for the device when a scene asks for them, by the rays a side of a probe, the samples of a tile and the fog on the rays
     *  they are made for: an option that does not change them leaves them be. */
    traced: new Map<string, TracedSceneKernel>(),
    /** The kernels of the stages a pass of the frame adds, by the probes' shape and the stage's key. */
    stages: new Map<string, StartedScreenStage>(),
    /** The kernels of the meshes' fields stage, by the rays they are made for. */
    meshStages: new Map<string, MeshStageKernel>(),
    clear() {
      caches.kernels.clear()
      caches.sets.clear()
      caches.traced.clear()
      caches.stages.clear()
      caches.meshStages.clear()
    },
  }
  return caches
}

/** The shapes the settings ask of the kernels, worked out once each. */
function createShapes() {
  let shapes = new WeakMap<ScreenProbeSettings, ShapeOf>()
  return {
    /** The shape a settings object asks of the kernels, worked out once. */
    shapeOf(wanted: ScreenProbeSettings) {
      let asked = shapes.get(wanted)
      if (!asked) {
        const shape = kernelShapeOf(wanted)
        shapes.set(wanted, (asked = { shape, key: shapeKey(shape), tracedKey: raysKey(shape) }))
      }
      return asked
    },
    /** The shape of `asked` for a cache stored in the format `light`, worked out once. */
    lightShapeOf(asked: ShapeOf, light: LightAtlasFormat) {
      if (asked.shape.light === light) return asked
      const held = (asked.byLight ??= new Map())
      let made = held.get(light)
      if (!made) {
        const shape = { ...asked.shape, light }
        held.set(light, (made = { shape, key: shapeKey(shape), tracedKey: asked.tracedKey }))
      }
      return made
    },
    /** The sources written for the last owner were cut to its limits (`groupWidth`): they are written again. */
    reset() {
      shapes = new WeakMap()
    },
  }
}

/** The settings of the probes, read again where an option moved. */
function createSettingsReader() {
  const watch = settingsWatch(SCREEN_PROBE_RULES)
  const lightWatch = settingsWatch(LIGHTING_DATA_FORMAT_RULES)
  let settings: ScreenProbeSettings | undefined
  return (options: Parameters<ScreenProbeStore['read']>[0]) => {
    const values = watch.read(options)
    const { lightingDataFormat } = lightWatch.read(options)
    if (watch.moved || lightWatch.moved || !settings)
      settings = resolveScreenProbes(values, lightingDataFormat)
    return settings
  }
}

/** The methods of the store that make the kernels of the scene's stages, each kept by the shape it is made for. */
function sceneKernels(
  own: (device: GPUDevice) => void,
  shapeOf: (wanted: ScreenProbeSettings) => ShapeOf,
  caches: ReturnType<typeof createKernelCaches>,
): Pick<ScreenProbeStore, 'tracedFor' | 'meshesFor' | 'stageFor'> {
  const { traced, meshStages, stages } = caches
  return {
    tracedFor(device, wanted, light) {
      own(device)
      const { shape, tracedKey } = shapeOf(wanted)
      const key = `${tracedKey}|${light}`
      let kernel = traced.get(key)
      if (!kernel) traced.set(key, (kernel = tracedSceneKernel(device, { ...shape, light })))
      return kernel
    },
    meshesFor(device, wanted, set) {
      own(device)
      const { shape, tracedKey } = shapeOf(wanted)
      const { light } = set.features
      const key = `${tracedKey}|${light}`
      let kernel = meshStages.get(key)
      if (!kernel)
        meshStages.set(key, (kernel = meshStageKernel(device, { ...shape, light }, set.cast)))
      return kernel
    },
    stageFor(device, wanted, set, stage) {
      own(device)
      const { shape } = shapeOf(wanted)
      const { light } = set.features
      const key = `${shape.side}x${shape.samples.join('x')}|${light}|${stage.key}`
      let kernel = stages.get(key)
      if (!kernel)
        stages.set(key, (kernel = startedScreenStage(device, { ...shape, light }, set.cast, stage)))
      return kernel
    },
  }
}

/** A store with no kernel and no settings read. */
export function createScreenProbeStore(): ScreenProbeStore {
  let owner: GPUDevice | undefined
  const caches = createKernelCaches()
  const { kernels, sets } = caches
  const shapes = createShapes()
  const { shapeOf, lightShapeOf } = shapes
  /** Makes `device` the owner of what is kept: what was made for another is dropped. */
  const own = (device: GPUDevice) => {
    if (owner === device) return
    owner = device
    caches.clear()
    shapes.reset()
    store.reason = null
  }
  const stands = createStandIns()
  const store: ScreenProbeStore = {
    reason: null,
    metrics: undefined,
    inputs: undefined,
    read: createSettingsReader(),
    kernelsFor(device, wanted, light) {
      own(device)
      const asked = lightShapeOf(shapeOf(wanted), light)
      const set = sets.get(asked.key)
      if (set) return set
      return assemble(store, device, kernels, sets, asked, () => owner === device)
    },
    meshes: newMeshStageState(),
    ...sceneKernels(own, shapeOf, caches),
    occlusionFor(device, wanted) {
      own(device)
      const source = occlusionSource(shapeOf(wanted).shape)
      const key = `occlusion|${source.key}`
      if (!kernels.has(key))
        startKernels(store, device, kernels, [['occlusion', source]], () => owner === device)
      return kernels.get(key)?.kernel as Kernel<'occlusion'> | undefined
    },
    fieldOcclusion: undefined,
    noVectors: stands.vectors,
    noCache: stands.cache,
    noPoses: stands.poses,
    dispose() {
      store.fieldOcclusion?.dispose()
      store.fieldOcclusion = undefined
      caches.clear()
      store.meshes = newMeshStageState()
      owner = undefined
      store.inputs = undefined
      stands.dispose()
    },
  }
  return store
}

/** The kernels of the shape `asked` from what is compiled, those missing asked of `device` together off the frame (the frames
 *  drawn without the probes meanwhile, `track`); the set once all are made, else none. */
function assemble(
  store: ScreenProbeStore,
  device: GPUDevice,
  kernels: Map<string, KernelEntry>,
  sets: Map<string, ScreenProbeKernels>,
  asked: ShapeOf,
  owned: () => boolean,
) {
  const sources = (asked.sources ??= Object.entries(
    screenProbeSources(
      asked.shape,
      groupWidth(device.limits),
      waveLanesOf(device, asked.shape),
      marchOf(device, asked.shape),
      hasSubgroups(device) ? 'native' : 'polyfill',
    ),
  ) as [string, KernelSource<string>][])
  const missing = sources.filter(([name, source]) => !kernels.has(`${name}|${source.key}`))
  if (missing.length) startKernels(store, device, kernels, missing, owned)
  const made: Record<string, Kernel<string>> = {}
  for (const [name, source] of sources) {
    const kernel = kernels.get(`${name}|${source.key}`)?.kernel
    if (!kernel) return undefined
    made[name] = kernel
  }
  const { occlusion, temporal, ...rest } = made
  const { extraAo, filterProbes, gatherMips, integrate, heightFog, shortRangeGi, light } =
    asked.shape
  // The kernels of the coarser levels of the filtered radiance are kept in the order of their levels.
  const mips: Kernel<string>[] = [],
    cast: Record<string, Kernel<string> | Kernel<string>[]> = { mips }
  for (const [name, kernel] of Object.entries(rest)) {
    const level = mipLevelOf(name)
    if (level) mips[+level - 1] = kernel
    else cast[name] = kernel
  }
  const set = {
    features: { extraAo, filterProbes, gatherMips, integrate, heightFog, shortRangeGi, light },
    occlusion,
    temporal,
    cast,
  } as unknown as ScreenProbeKernels
  sets.set(asked.key, set)
  asked.sources = undefined
  return set
}

/** Asks `device` for the `missing` kernels together, their entries held until they land; a refusal is the store's reason. */
function startKernels(
  store: ScreenProbeStore,
  device: GPUDevice,
  kernels: Map<string, KernelEntry>,
  missing: readonly (readonly [string, KernelSource<string>])[],
  owned: () => boolean,
) {
  const entries = missing.map(([name, source]) => {
    const entry: KernelEntry = {}
    kernels.set(`${name}|${source.key}`, entry)
    return entry
  })
  // A refused kernel stays an entry without a pipeline: the set is never made, and no frame asks for it again. The refusal of a
  // device that is no longer the owner is none of the store's: its entries went with it.
  const refuse = (why: string) => {
    if (owned()) store.reason = why
  }
  const compile = compileScreenProbeKernels(device, missing).then(
    ({ value, refused }) => {
      if (!value) return refuse(refused ?? 'the device refused the screen probes')
      for (const [at, [name]] of missing.entries()) entries[at].kernel = value[name]
    },
    (error: unknown) => refuse(String(error)),
  )
  track(device, compile, false, 'screen probe kernels')
}
