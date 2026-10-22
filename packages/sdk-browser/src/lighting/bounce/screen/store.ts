import { settingsWatch } from '../../../../../sdk-core/src/contracts/settingRules.ts'
import {
  SCREEN_PROBE_RULES,
  resolveScreenProbes,
  type ScreenProbeOptions,
  type ScreenProbeSettings,
} from '../../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import type { ScreenProbeFrameMetrics } from '../../../../../sdk-core/src/contracts/shadowMetrics.ts'
import { standInTexture } from '../../../gpu/core/standInTexture.ts'
import { groupWidth } from '../../../gpu/dispatch/grid.ts'
import { track } from '../../deferred/compileLedger.ts'
import { VECTOR_FORMAT } from '../../../post/taa/velocityWgsl.ts'
import {
  compileScreenProbeKernels,
  kernelShapeOf,
  screenProbeSources,
  type Kernel,
  type KernelShape,
  type KernelSource,
  type ScreenProbeKernels,
} from './kernels.ts'

/** The stand-ins of the radiance cache's maps (`ScreenProbeStore.noCache`). */
interface NoCache {
  final: GPUTextureView
  raw: GPUTextureView
  tags: GPUBuffer
  pdf: GPUBuffer
}

/** A kernel in the making or made: `kernel` once the device has handed its pipelines back. */
interface KernelEntry {
  kernel?: Kernel<string>
}

/** What a settings object asks of the kernels, once: their shape and the key two shapes that agree share a set by. */
interface ShapeOf {
  shape: KernelShape
  key: string
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
  /** What the kernels bind for the surfaces' vectors where the image drew none: a texel of zero. */
  noVectors(device: GPUDevice): GPUTextureView
  /** What the kernels bind for the radiance cache where there is none: texels and tags of zero, and importance functions nothing reads. */
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
  const shapes = new WeakMap<ScreenProbeSettings, ShapeOf>()
  let stand: { device: GPUDevice; texture: GPUTexture; view: GPUTextureView } | undefined
  let standCache:
    { device: GPUDevice; made: GPUTexture[]; buffers: GPUBuffer[]; views: NoCache } | undefined
  const destroyStandCache = () => {
    for (const resource of [...(standCache?.made ?? []), ...(standCache?.buffers ?? [])])
      resource.destroy()
    standCache = undefined
  }
  const store: ScreenProbeStore = {
    reason: null,
    metrics: undefined,
    read(options) {
      const values = watch.read(options)
      if (watch.moved || !settings) settings = resolveScreenProbes(values)
      return settings
    },
    kernelsFor(device, wanted) {
      if (owner !== device) {
        owner = device
        kernels.clear()
        sets.clear()
      }
      let asked = shapes.get(wanted)
      if (!asked) {
        const shape = kernelShapeOf(wanted)
        const key = `${shape.casts}|${shape.side}|${shape.gather}|${shape.samples}|${shape.occlusion.downsample}|${shape.occlusion.pyramid}|${shape.occlusion.power}|${shape.scene}`
        shapes.set(wanted, (asked = { shape, key }))
      }
      const set = sets.get(asked.key)
      if (set) return set
      return assemble(store, device, kernels, sets, asked)
    },
    noVectors(device) {
      if (!stand || stand.device !== device) {
        stand?.texture.destroy()
        const texture = standInTexture(device, 'Trillion3D empty surface vectors', VECTOR_FORMAT)
        stand = { device, texture, view: texture.createView() }
      }
      return stand.view
    },
    noCache(device) {
      if (!standCache || standCache.device !== device) {
        destroyStandCache()
        const final = standInTexture(device, 'Trillion3D empty radiance cache', 'r32uint')
        const raw = standInTexture(device, 'Trillion3D empty radiance cache raw', 'rg32uint')
        const buffer = (label: string) =>
          device.createBuffer({ label, size: 16, usage: GPUBufferUsage.STORAGE })
        const tags = buffer('Trillion3D empty radiance cache tags'),
          pdf = buffer('Trillion3D empty radiance cache importance')
        standCache = {
          device,
          made: [final, raw],
          buffers: [tags, pdf],
          views: { final: final.createView(), raw: raw.createView(), tags, pdf },
        }
      }
      return standCache.views
    },
    dispose() {
      kernels.clear()
      sets.clear()
      owner = undefined
      stand?.texture.destroy()
      stand = undefined
      destroyStandCache()
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
) {
  const sources = (asked.sources ??= Object.entries(
    screenProbeSources(asked.shape, groupWidth(device.limits)),
  ) as [string, KernelSource<string>][])
  const missing = sources.filter(([name, source]) => !kernels.has(`${name}|${source.key}`))
  if (missing.length) startKernels(store, device, kernels, missing)
  const made: Record<string, Kernel<string>> = {}
  for (const [name, source] of sources) {
    const kernel = kernels.get(`${name}|${source.key}`)?.kernel
    if (!kernel) return undefined
    made[name] = kernel
  }
  const { occlusion, temporal, ...cast } = made
  const set = {
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
) {
  const entries = missing.map(([name, source]) => {
    const entry: KernelEntry = {}
    kernels.set(`${name}|${source.key}`, entry)
    return entry
  })
  // A refused kernel stays an entry without a pipeline: the set is never made, and no frame asks for it again.
  const refuse = (why: string) => void (store.reason = why)
  const compile = compileScreenProbeKernels(device, missing).then(
    ({ value, refused }) => {
      if (!value) return refuse(refused ?? 'the device refused the screen probes')
      for (const [at, [name]] of missing.entries()) entries[at].kernel = value[name]
    },
    (error: unknown) => refuse(String(error)),
  )
  track(device, compile, false)
}
