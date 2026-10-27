import { settingsWatch } from '../../../../../sdk-core/src/contracts/settingRules.ts'
import {
  SCREEN_PROBE_RULES,
  resolveScreenProbes,
  type ScreenProbeOptions,
  type ScreenProbeSettings,
} from '../../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import type { ScreenProbeFrameMetrics } from '../../../../../sdk-core/src/contracts/shadowMetrics.ts'
import { groupWidth } from '../../../gpu/dispatch/grid.ts'
import { track } from '../../deferred/compileLedger.ts'
import type { ScreenProbeInputs } from './groupParts.ts'
import { createStandIns, type NoCache } from './standIns.ts'
import {
  compileScreenProbeKernels,
  kernelShapeOf,
  mipLevelOf,
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
  read(options: ScreenProbeOptions): ScreenProbeSettings
  /** The kernels `settings` need on `device`, asked of it off the frame: none while any is compiling or refused. */
  kernelsFor(device: GPUDevice, settings: ScreenProbeSettings): ScreenProbeKernels | undefined
  /** The kernel that casts the scene stage of `settings` through the scene's triangles on `device`, compiled off the frame on the first ask:
   *  read once `ready`. */
  tracedFor(device: GPUDevice, settings: ScreenProbeSettings): TracedSceneKernel
  /** What the groups name of the image being cast, written over at each image (`inputsOf`, `frame.ts`): none before the first. */
  inputs: ScreenProbeInputs | undefined
  /** What the kernels bind for the surfaces' vectors where the image drew none: a texel of zero. */
  noVectors(device: GPUDevice): GPUTextureView
  /** What the kernels bind for the radiance cache where there is none: texels of zero. */
  noCache(device: GPUDevice): NoCache
  dispose(): void
}

/** A store with no kernel and no settings read. */
export function createScreenProbeStore(): ScreenProbeStore {
  const watch = settingsWatch(SCREEN_PROBE_RULES)
  let settings: ScreenProbeSettings | undefined
  let owner: GPUDevice | undefined
  const kernels = new Map<string, KernelEntry>()
  const sets = new Map<string, ScreenProbeKernels>()
  /** The kernels that cast the scene stage through the scene's triangles, made for the device when a scene asks for them, by the rays a side of a probe, the samples of a tile and the fog on the rays
   *  they are made for: an option that does not change them leaves them be. */
  const traced = new Map<string, TracedSceneKernel>()
  let shapes = new WeakMap<ScreenProbeSettings, ShapeOf>()
  /** The shape a settings object asks of the kernels, worked out once. */
  const shapeOf = (wanted: ScreenProbeSettings) => {
    let asked = shapes.get(wanted)
    if (!asked) {
      const shape = kernelShapeOf(wanted)
      shapes.set(wanted, (asked = { shape, key: shapeKey(shape), tracedKey: raysKey(shape) }))
    }
    return asked
  }
  /** Makes `device` the owner of what is kept: what was made for another is dropped. */
  const own = (device: GPUDevice) => {
    if (owner === device) return
    owner = device
    kernels.clear()
    sets.clear()
    traced.clear()
    // The sources written for the last owner were cut to its limits (`groupWidth`): they are written again.
    shapes = new WeakMap()
    store.reason = null
  }
  const stands = createStandIns()
  const store: ScreenProbeStore = {
    reason: null,
    metrics: undefined,
    inputs: undefined,
    read(options) {
      const values = watch.read(options)
      if (watch.moved || !settings) settings = resolveScreenProbes(values)
      return settings
    },
    kernelsFor(device, wanted) {
      own(device)
      const asked = shapeOf(wanted)
      const set = sets.get(asked.key)
      if (set) return set
      return assemble(store, device, kernels, sets, asked, () => owner === device)
    },
    tracedFor(device, wanted) {
      own(device)
      const { shape, tracedKey } = shapeOf(wanted)
      let kernel = traced.get(tracedKey)
      if (!kernel) traced.set(tracedKey, (kernel = tracedSceneKernel(device, shape)))
      return kernel
    },
    noVectors: stands.vectors,
    noCache: stands.cache,
    dispose() {
      kernels.clear()
      sets.clear()
      traced.clear()
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
    screenProbeSources(asked.shape, groupWidth(device.limits)),
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
  const { extraAo, filterProbes, gatherMips, integrate, heightFog } = asked.shape
  // The kernels of the coarser levels of the filtered radiance are kept in the order of their levels.
  const mips: Kernel<string>[] = [],
    cast: Record<string, Kernel<string> | Kernel<string>[]> = { mips }
  for (const [name, kernel] of Object.entries(rest)) {
    const level = mipLevelOf(name)
    if (level) mips[+level - 1] = kernel
    else cast[name] = kernel
  }
  const set = {
    features: { extraAo, filterProbes, gatherMips, integrate, heightFog },
    occlusion,
    temporal,
    ...(asked.shape.casts && { cast }),
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
  track(device, compile, false)
}
