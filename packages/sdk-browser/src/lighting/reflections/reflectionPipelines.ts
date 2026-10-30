/** THE REFLECTIONS' KERNELS AND THEIR GROUP'S LAYOUT, once a device: what every view's reflection
 *  (`gpu.ts`) and the forward programs that read it bind. */
import {
  heldMakerOf,
  NO_SCENE_MASKS,
  oncePerDeviceOverPrograms,
  sceneMaskKey,
  type SceneMaskPrograms,
} from '../rays/sceneTrace/sceneMaskPrograms.ts'
import { oncePerDevice, oncePerDeviceKey } from '../../gpu/core/oncePerDevice.ts'
import { WORD_LIGHT_FORMAT, type LightAtlasFormat } from '../../gpu/core/lightAtlasFormat.ts'
import { hasFloat32Filterable } from '../../gpu/core/float32Filterable.ts'
import { validated } from '../../gpu/core/errorScope.ts'
import { shaderFailed } from '../../gpu/core/shaderModule.ts'
import { startedComputeStages } from '../../gpu/core/computeStages.ts'
import {
  COMPUTE,
  computeBufferEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../gpu/core/computeBindings.ts'
import { skyLightReadLayoutEntries } from '../../modules/sky/skyLight/read.ts'
import { hizDepthEntries, hizLevelZeroEntries } from '../../visibility/hiz/gpu/pyramidTexture.ts'
import { hasSubgroupsOf } from '../../gpu/core/subgroups.ts'
import { MARCH_VIRTUAL_LANES } from '../../visibility/hiz/gpu/screenMarchLanes.ts'
import { reflectionTraceShader } from './trace/trace.ts'
import {
  hardwareHitLayout,
  hardwareMaskedTraceLayout,
  hardwareSceneLayout,
  hardwareTraceLayout,
  traceLayouts,
} from './trace/traceBindings.ts'
import { createTraceStages } from './trace/traceEncode.ts'
import type { HitLitMode } from './hitLighting/constants.ts'
import {
  REFLECTION_DEPTH_BINDING,
  REFLECTION_FRONT_BINDING,
  REFLECTION_IMAGE_BINDING,
  REFLECTION_LIGHT_VIEW_BINDING,
  REFLECTION_SKY_LIGHT,
  REFLECTION_VIEW_BINDING,
  REFLECTION_VIEW_BYTES,
} from './viewLayout.ts'

/** The parts of the reflection group a layout holds beside the view, the lighting's view and the sky light, which every layout holds: the depth (the whole
 *  pyramid, its first level alone, or none), the lit image the last image lit and the transparents' front depth. */
interface ReflectionParts {
  depth: 'pyramid' | 'level0' | 'none'
  image: boolean
  front: boolean
}

/** The entries of the reflection group (`reflectionBindingsWgsl`) as `visibility` sees them, holding `parts`, in the group's order: the view uniform, the depth
 *  (`hizDepthEntries`), the lighting's view, the lit image (`hdrTargetDescriptor`), the front depth, the sky light. */
const reflectionEntries = (visibility: GPUShaderStageFlags, parts: ReflectionParts) => [
  computeUniformEntry(
    REFLECTION_VIEW_BINDING,
    { minBindingSize: REFLECTION_VIEW_BYTES },
    visibility,
  ),
  ...(parts.depth === 'pyramid' ? hizDepthEntries(REFLECTION_DEPTH_BINDING, visibility) : []),
  ...(parts.depth === 'level0' ? hizLevelZeroEntries(REFLECTION_DEPTH_BINDING, visibility) : []),
  computeBufferEntry(REFLECTION_LIGHT_VIEW_BINDING, 'uniform', visibility),
  ...(parts.image
    ? [computeTextureEntry(REFLECTION_IMAGE_BINDING, 'float', '2d', visibility)]
    : []),
  // The transparents' front depth, a depth texture read as the float it holds.
  ...(parts.front
    ? [computeTextureEntry(REFLECTION_FRONT_BINDING, 'unfilterable-float', '2d', visibility)]
    : []),
  // The sky light: its cubes, sampler, harmonics and the view's uniform.
  ...skyLightReadLayoutEntries(REFLECTION_SKY_LIGHT, visibility),
]

/** The reflection group's layout (`reflectionBindingsWgsl`), once a device: the view uniform, then the
 *  depth pyramid, the lighting's view and the lit image the last image lit, the front depth, read by compute and fragment stages. */
export const reflectionLayout = oncePerDevice((device: GPUDevice) =>
  device.createBindGroupLayout({
    entries: reflectionEntries(COMPUTE | GPUShaderStage.FRAGMENT, {
      depth: 'pyramid',
      image: true,
      front: true,
    }),
  }),
)

/** The forward programs' reflection group layout, once a device: of the reflection group's bindings (`reflectionLayout`) the ones a forward
 *  fragment reads — the view uniform, level 0 of the depth (the screen segment of a translucent surface's traced shadow reads it,
 *  `vsmScreenSegmentWgsl`) and its levels, the lighting's view and the sky light —, not the depth pyramid nor the lit
 *  image, which only the trace reads, nor the front depth, which the front's traced radiance carries (`FRONT_TRACED_FORMAT`): three of the
 *  fragment stage's sixteen sampled textures spared. */
export const reflectionForwardLayout = oncePerDevice((device: GPUDevice) =>
  device.createBindGroupLayout({
    entries: reflectionEntries(GPUShaderStage.FRAGMENT, {
      depth: 'level0',
      image: false,
      front: false,
    }).map((entry) =>
      // The vertex stage works the fog out at each vertex (`fogLaidFar`): it reads the view and the sky light's uniform.
      entry.binding === REFLECTION_VIEW_BINDING || entry.binding === REFLECTION_SKY_LIGHT.params
        ? { ...entry, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT }
        : entry,
    ),
  }),
)

/** The reflection group layout of the hit lighting's first pass, once a device: of the reflection group's bindings (`reflectionLayout`) all but the lit image, which
 *  only the passes that read a hit's screen light read (`reflectionHeld`): one of the compute stage's sixteen sampled textures spared, which the light profiles' atlas takes. */
export const reflectionHitLayout = oncePerDevice((device: GPUDevice) =>
  device.createBindGroupLayout({
    entries: reflectionEntries(COMPUTE, { depth: 'pyramid', image: false, front: true }),
  }),
)

/** The reflection group layout of the screen probes' scene stages, once a device: of the reflection group's bindings (`reflectionLayout`) the ones a ray
 *  answered by the scene reads — the view uniform, the lighting's view and the sky light —, not the depth, the lit image nor the front depth, which only the
 *  screen's trace and the pixels read: four of the compute stage's sixteen sampled textures spared, which the fog laid over the rays needs. */
export const reflectionSceneLayout = oncePerDevice((device: GPUDevice) =>
  device.createBindGroupLayout({
    entries: reflectionEntries(COMPUTE, { depth: 'none', image: false, front: false }),
  }),
)

/** The reflection's kernels — the tiles' classification, the trace, reuse, accumulation and filter of
 *  both surfaces — compiled once a device under one validation scope, with the counting of the rays
 *  (`statistics`, `reflectionStatistics`) or without it, each kept apart, and for the format the surface cache's final light is stored in
 *  (`light`): a format that moved brings kernels of its own. */
const kernelsOf = (statistics: boolean) =>
  oncePerDeviceKey((device: GPUDevice, light: LightAtlasFormat) =>
    validated(device, async () => {
      // The minimum occupancy counts the lanes of a subgroup of 32: the subgroups' sum where the device runs subgroups of exactly that size, so that it
      // is the number the polyfill gives, else the count the workgroup keeps, over virtual subgroups of 32.
      const wave32 = hasSubgroupsOf(device, MARCH_VIRTUAL_LANES)
      const lanes = wave32 ? 'native' : 'polyfill'
      const label = 'Trillion3D reflection trace (subgroups of 32 ' + lanes + ')'
      const trace = device.createShaderModule({
        label,
        code: reflectionTraceShader(
          statistics,
          false,
          lanes,
          light,
          undefined,
          undefined,
          undefined,
          hasFloat32Filterable(device.features),
        ),
      })
      // Every layout is made before the first `await`, in the scope.
      const group = reflectionLayout(device),
        layouts = traceLayouts(device, statistics, light)
      if (await shaderFailed(trace)) return undefined
      const stages = await createTraceStages(device, { trace }, group, layouts)
      return { ...stages, light }
    }),
  )
const counting = kernelsOf(true),
  silent = kernelsOf(false)
export const createReflectionPipelines = (
  device: GPUDevice,
  statistics = false,
  light: LightAtlasFormat = WORD_LIGHT_FORMAT,
) => (statistics ? counting : silent)(device, light)
export type ReflectionPipelines = NonNullable<Awaited<ReturnType<typeof createReflectionPipelines>>>

/** The format each view's kernels were last asked for (`followReflectionLight`). */
const askedLight = new WeakMap<object, LightAtlasFormat>()

/**
 * The kernels of `vis` follow the format `wanted` the surface cache's final light is stored in: those held are for another, so the kernels of `wanted` are asked of
 * the device, off the frame, and taken once built; until then the rays' hits bind the stand-ins of the format held (`surfaceHitReads`) and find no card.
 */
export function followReflectionLight(
  vis: { reflectionPipelines: ReflectionPipelines | undefined },
  device: GPUDevice,
  statistics: boolean,
  wanted: LightAtlasFormat,
) {
  if (!vis.reflectionPipelines || vis.reflectionPipelines.light === wanted) return
  if (askedLight.get(vis) === wanted) return
  askedLight.set(vis, wanted)
  createReflectionPipelines(device, statistics, wanted).then(
    (next) => {
      if (next && askedLight.get(vis) === wanted) vis.reflectionPipelines = next
    },
    () => askedLight.delete(vis),
  )
}
/** The scene stage's program through the scene's triangles, compiled once a device, a set of mask programs, a format of the cache's light and a mode (`HitLitMode`): the trace's own (`none`, no hit lighting code in it), the one that also marks the hits to light again and holds the hit lighting's first pass (`direct`), or the one whose cards are read for their indirect light, for the second (`finish`). */
const traceModulesOver = oncePerDeviceOverPrograms(
  (device: GPUDevice, key: `${LightAtlasFormat} ${HitLitMode}`, programs) => {
    const [light, lit] = key.split(' ') as [LightAtlasFormat, HitLitMode]
    return device.createShaderModule({
      label: `Trillion3D reflection scene trace ${lit} ${sceneMaskKey(programs)}`,
      code: reflectionTraceShader(false, true, 'none', light, undefined, programs, lit),
    })
  },
)
export const reflectionTraceModule = (
  device: GPUDevice,
  light: LightAtlasFormat,
  programs: SceneMaskPrograms,
  lit: HitLitMode,
) => traceModulesOver(device, `${light} ${lit}`, programs)
/** The entry the scene stage runs, in either of its programs. */
const SCENE_ENTRY = 'traceScene'
/** The entry of the program through the scene's triangles that traces the rays, before `SCENE_ENTRY` answers from what they met. */
const HIT_ENTRY = 'traceSceneHit'

/**
 * The scene stage that casts its rays through the scene's triangles (`reflectionTraceShader` with `hardware`), made once for the device when
 * a scene has acceleration structures and its reflections are traced that way: for the opaque surface and for the transparents'
 * front one, two kernels over the rays the screen missed, compiled off the frame and not waited for by the reflections' own kernels — until
 * they are `ready` the rays are marched through the field. The trace (`traceSceneHit`) has its own group 0 (`hardwareHitLayout`), the reflection group and the scene trace's
 * with its any-hit test (`hardwareMaskedTraceLayout`); the answer (`traceScene`) the scene stage's group 0, the reflection group and the scene trace's alone: the colour atlas of the masks and the cache's
 * textures do not share a stage's sixteen sampled textures.
 */
const hardwareKernelsOver = oncePerDeviceOverPrograms(
  (device: GPUDevice, key: `${LightAtlasFormat} ${boolean}`, programs) => {
    const [light, litKey] = key.split(' ') as [LightAtlasFormat, string]
    const layouts = {
      hit: device.createPipelineLayout({
        bindGroupLayouts: [
          hardwareHitLayout(device),
          reflectionLayout(device),
          hardwareMaskedTraceLayout(device),
        ],
      }),
      answer: device.createPipelineLayout({
        bindGroupLayouts: [
          hardwareSceneLayout(device, light),
          reflectionLayout(device),
          hardwareTraceLayout(device),
        ],
      }),
    }
    // Where the hit lighting runs the program also marks the hits to light again, and is the very module its first pass runs (`hitLighting/kernels.ts`).
    const module = reflectionTraceModule(
      device,
      light,
      programs,
      litKey === 'true' ? 'direct' : 'none',
    )
    // The surface's layer, the pipeline's (`REFLECTION_LAYER_WGSL`): 0 the opaque, 1 the front.
    const stages = [0, 1].flatMap((layer) =>
      (
        [
          ['hit', HIT_ENTRY],
          ['answer', SCENE_ENTRY],
        ] as const
      ).map(([which, entry]) =>
        startedComputeStages(
          device,
          `Trillion3D reflection scene trace ${layer} ${sceneMaskKey(programs)}`,
          layouts[which],
          module,
          [entry],
          { REFLECTION_LAYER: layer },
        ),
      ),
    )
    return {
      /** The format of the cache's final light the stage is for. */
      light,
      /** Whether its program marks the hits to light again, and so keeps the key of their material in the hits' records (`reflectionHitWords`). */
      lit: litKey === 'true',
      get ready() {
        return stages.every((stage) => stage.ready)
      },
      get pending() {
        return stages.some((stage) => stage.pending)
      },
      /** The compiled pipeline of the trace of the surface `layer`'s rays: read once `ready`. */
      hit: (layer: number) => stages[layer * 2].pipelineOf(HIT_ENTRY),
      /** The compiled pipeline of the answer of the surface `layer`: read once `ready`. */
      pipeline: (layer: number) => stages[layer * 2 + 1].pipelineOf(SCENE_ENTRY),
    }
  },
)

type HardwareKey = `${LightAtlasFormat} ${boolean}`
const hardwareKeys = new Map<LightAtlasFormat, readonly [HardwareKey, HardwareKey]>()
/** The key of the scene stage's kernels for a format of the cache's light and whether the hit lighting runs: the strings are made once each, the stage asking for its kernels every image. */
export function hardwareKernelKey(light: LightAtlasFormat, lit: boolean): HardwareKey {
  let keys = hardwareKeys.get(light)
  if (!keys) hardwareKeys.set(light, (keys = [`${light} false`, `${light} true`]))
  return keys[lit ? 1 : 0]
}

/** The scene stage over the graph masks `programs` its rays cut the surfaces by (the programs `maskHold.use` returns). */
export const hardwareReflectionKernels = (
  device: GPUDevice,
  light: LightAtlasFormat,
  programs: SceneMaskPrograms = NO_SCENE_MASKS,
  lit = false,
) => hardwareKernelsOver(device, hardwareKernelKey(light, lit), programs)

/** The maker of the scene stage for a device and a key (`hardwareKernelKey`), as the mask hold takes it (`maskHold.use`): one function each, not one an image. */
export const hardwareReflectionMaker = heldMakerOf(hardwareKernelsOver)
