import type { GpuHiz, HizDepth } from '../../visibility/hiz/gpu/types.ts'
import {
  hizDepthBindEntries,
  hizLevelZeroBindEntries,
} from '../../visibility/hiz/gpu/pyramidTexture.ts'
import type { GlobalFieldRead } from '../distanceField/view.ts'
import type { ScreenReflection } from './gpu.ts'
import { skyLightReadBindEntries, type SkyLightReadSet } from '../../modules/sky/skyLight/read.ts'
import { heldProgramGroup, keptProgramGroup } from '../../gpu/bind/programGroups.ts'
import { namedEntries } from '../../gpu/core/computeBindings.ts'
import { oncePerDeviceKey } from '../../gpu/core/oncePerDevice.ts'
import { standInBuffer, standInTexture } from '../../gpu/core/standIns.ts'
import {
  grantsTranslucentReflection,
  translucentReflectionLight,
} from '../../gpu/core/translucentReflection.ts'
import type { LightAtlasFormat } from '../../gpu/core/lightAtlasFormat.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { BOUNCE_ATLAS_FORMAT } from '../bounce/atlas.ts'
import { radianceCacheFormats } from '../bounce/cache/cacheLayout.ts'
import { BOUNCE_GRID_BYTES } from '../bounce/uniform.ts'
import { SCREEN_PROBE_PARAMS_BYTES } from '../bounce/screen/screenProbeLayout.ts'
import type { ScreenProbeView } from '../bounce/screen/view.ts'
import { RADIANCE_CACHE_BINDINGS, RADIANCE_CACHE_PROBES } from './radianceCache/wgsl.ts'
import {
  reflectionHitLayout,
  reflectionSceneLayout,
  reflectionForwardLayout,
  reflectionLayout,
} from './reflectionPipelines.ts'
import {
  REFLECTION_DEPTH_BINDING,
  REFLECTION_FRONT_BINDING,
  REFLECTION_GROUP,
  REFLECTION_IMAGE_BINDING,
  REFLECTION_LIGHT_VIEW_BINDING,
  REFLECTION_SKY_LIGHT,
  REFLECTION_VIEW_BINDING,
} from './viewLayout.ts'

/** The reflection group of `reflection` over the depth pyramid `depth` (`GpuHiz.depth`), the lit
 *  image it holds now, its front layer's depth and the lighting's view `lightView`, made
 *  again when one of them is not the one it was made over: the two HDR targets taking turns find a
 *  group each. */
export function reflectionGroup(
  reflection: ScreenReflection,
  depth: HizDepth,
  lightView: GPUBuffer,
  sky: SkyLightReadSet,
) {
  const image = reflection.lit.image.texture,
    { identity, slots } = reflection.group
  const { next } = identity
  next.length = 0
  next.push(depth, image, lightView, sky.cube, sky.harmonics, sky.params)
  const moved = identity.moved()
  const kept = slots[identity.slot]
  if (kept && !moved) return kept
  const { device } = reflection
  return (slots[identity.slot] = device.createBindGroup({
    label: 'Trillion3D reflection',
    layout: reflectionLayout(device),
    entries: [
      { binding: REFLECTION_VIEW_BINDING, resource: { buffer: reflection.uniform } },
      ...hizDepthBindEntries(REFLECTION_DEPTH_BINDING, depth),
      { binding: REFLECTION_LIGHT_VIEW_BINDING, resource: { buffer: lightView } },
      // The lit image the last image lit (`hdrTargetDescriptor`).
      { binding: REFLECTION_IMAGE_BINDING, resource: image.createView() },
      // The transparents' front depth, the front pass's depth itself (`frontLayer.ts`).
      { binding: REFLECTION_FRONT_BINDING, resource: reflection.front.views.depth },
      ...skyLightReadBindEntries(REFLECTION_SKY_LIGHT, sky),
    ],
  }))
}

/** What the forward programs read of the scene beside the reflection's own (`translucentReflectionWgsl`): the last lit image, the radiance cache's resources. */
interface ForwardScene {
  image: GPUTextureView
  params: GPUBuffer
  grid: GPUBuffer
  table: GPUTextureView
  final: GPUTextureView
  raw: GPUTextureView
  sky: GPUTextureView
}

/** The resources a forward program binds in place of the radiance cache where it is not made, whose levels cover no point (the grid's zeroes): the cache's
 *  parameters, the levels' uniform, the cell table and the three maps in the formats the cache keeps them in (`light`). One for the device and format. */
const noCache = oncePerDeviceKey((device: GPUDevice, light: LightAtlasFormat) => {
  const F = radianceCacheFormats(light)
  const uniform = GPUBufferUsage.UNIFORM
  return {
    params: standInBuffer(
      device,
      'Trillion3D cache none parameters',
      SCREEN_PROBE_PARAMS_BYTES,
      uniform,
    ),
    grid: standInBuffer(device, 'Trillion3D cache none levels', BOUNCE_GRID_BYTES, uniform),
    table: standInTexture(device, 'Trillion3D cache none table', BOUNCE_ATLAS_FORMAT, {
      dimension: '2d',
    }).createView({ dimension: '2d-array' }),
    final: standInTexture(device, 'Trillion3D cache none final', F.final).createView(),
    raw: standInTexture(device, 'Trillion3D cache none raw', F.raw).createView(),
    sky: standInTexture(device, 'Trillion3D cache none sky', F.sky).createView(),
  }
})

/** The scene each reflection's forward programs read, one object a reflection made once and set again at each bind (nothing is allocated by a bind). */
const sceneOf = new WeakMap<ScreenReflection, ForwardScene>()

/** The scene a forward program of `reflection` reflects, none on a device that does not grant the sampled textures for it (`grantsTranslucentReflection`): the radiance cache
 *  of the world's probes with the screen probes' parameters when both are made and the cache keeps its maps in the format the layout holds
 *  (`translucentReflectionLight`), else the stand-ins of no cache. */
function forwardSceneResources(
  reflection: ScreenReflection,
  rt: ReflectionHost,
): ForwardScene | undefined {
  const { device } = reflection
  if (!grantsTranslucentReflection(device)) return undefined
  const light = translucentReflectionLight(device)
  const probes = rt.bounce?.probes
  const cache = probes?.cache.views
  const screen = rt.gpu.screenProbes
  const params = screen?.indirect && screen.resources.params
  const none = noCache(device, light)
  const real = !!probes && !!cache && !!params && cache.light === light
  let scene = sceneOf.get(reflection)
  if (!scene) sceneOf.set(reflection, (scene = { ...none, image: reflection.lit.image.view }))
  scene.image = reflection.lit.image.view
  scene.params = real ? params : none.params
  scene.grid = real ? probes.uniform : none.grid
  scene.table = real ? probes.table : none.table
  scene.final = real ? cache.final : none.final
  scene.raw = real ? cache.raw : none.raw
  scene.sky = real ? cache.sky : none.sky
  return scene
}

/** The forward programs' reflection group of `reflection` (`reflectionForwardLayout`): the view, the depth `depth` (`GpuHiz.depth`; level 0 and its levels, the whole
 *  pyramid with `scene`), the lighting's view `lightView` and the sky light, with `scene` the last lit image and the radiance cache; made again when one of them is not the one it was made over. */
function forwardReflectionGroup(
  reflection: ScreenReflection,
  depth: HizDepth,
  lightView: GPUBuffer,
  sky: SkyLightReadSet,
  scene: ForwardScene | undefined,
) {
  const { device, forward } = reflection
  const { next } = forward.identity
  next.length = 0
  next.push(depth, lightView, sky.cube, sky.harmonics, sky.params)
  if (scene)
    next.push(scene.image, scene.params, scene.grid, scene.table, scene.final, scene.raw, scene.sky)
  return (
    heldProgramGroup(forward) ??
    keptProgramGroup(
      device,
      reflectionForwardLayout(device),
      forward,
      [
        { binding: REFLECTION_VIEW_BINDING, resource: { buffer: reflection.uniform } },
        ...(scene
          ? hizDepthBindEntries(REFLECTION_DEPTH_BINDING, depth)
          : hizLevelZeroBindEntries(REFLECTION_DEPTH_BINDING, depth)),
        { binding: REFLECTION_LIGHT_VIEW_BINDING, resource: { buffer: lightView } },
        ...skyLightReadBindEntries(REFLECTION_SKY_LIGHT, sky),
        ...(scene
          ? [
              { binding: REFLECTION_IMAGE_BINDING, resource: scene.image },
              ...namedEntries(RADIANCE_CACHE_BINDINGS.at, {
                params: { buffer: scene.params },
                bounceGrid: { buffer: scene.grid },
                cacheFinal: scene.final,
                cacheRaw: scene.raw,
                cacheSky: scene.sky,
              }),
              { binding: RADIANCE_CACHE_PROBES, resource: scene.table },
            ]
          : []),
      ],
      'Trillion3D reflection forward',
    )
  )
}

/** The reflection group of the screen probes' scene stages (`reflectionSceneLayout`): the view, the lighting's view `lightView` and the sky light, made again
 *  when one of them is not the one it was made over. */
export function reflectionSceneGroup(
  reflection: ScreenReflection,
  lightView: GPUBuffer,
  sky: SkyLightReadSet,
) {
  const { device, scene } = reflection
  const { next } = scene.identity
  next.length = 0
  next.push(lightView, sky.cube, sky.harmonics, sky.params)
  return (
    heldProgramGroup(scene) ??
    keptProgramGroup(
      device,
      reflectionSceneLayout(device),
      scene,
      [
        { binding: REFLECTION_VIEW_BINDING, resource: { buffer: reflection.uniform } },
        { binding: REFLECTION_LIGHT_VIEW_BINDING, resource: { buffer: lightView } },
        ...skyLightReadBindEntries(REFLECTION_SKY_LIGHT, sky),
      ],
      'Trillion3D reflection scene',
    )
  )
}

/** The reflection group of the hit lighting's first pass (`reflectionHitLayout`): the view, the depth `depth` (`GpuHiz.depth`), the lighting's view `lightView`, the front depth and the sky light, without the lit image;
 *  made again when one of them is not the one it was made over. */
export function reflectionHitGroup(
  reflection: ScreenReflection,
  depth: HizDepth,
  lightView: GPUBuffer,
  sky: SkyLightReadSet,
) {
  const { device, hit } = reflection
  const { next } = hit.identity
  next.length = 0
  next.push(depth, lightView, sky.cube, sky.harmonics, sky.params)
  return (
    heldProgramGroup(hit) ??
    keptProgramGroup(
      device,
      reflectionHitLayout(device),
      hit,
      [
        { binding: REFLECTION_VIEW_BINDING, resource: { buffer: reflection.uniform } },
        ...hizDepthBindEntries(REFLECTION_DEPTH_BINDING, depth),
        { binding: REFLECTION_LIGHT_VIEW_BINDING, resource: { buffer: lightView } },
        { binding: REFLECTION_FRONT_BINDING, resource: reflection.front.views.depth },
        ...skyLightReadBindEntries(REFLECTION_SKY_LIGHT, sky),
      ],
      'Trillion3D reflection hit lighting',
    )
  )
}

/** What a frame holds that the reflection reads (`reflectionLightView`, `reflectionField`). */
type ReflectionHost = {
  gpu: {
    reflection?: ScreenReflection
    screenProbes?: ScreenProbeView
    deferred?: {
      uniform: GPUBuffer
      placeholders: { distanceField: GlobalFieldRead }
    }
  }
  vis: { gpuHiz?: GpuHiz }
  distanceFields?: { scene: GlobalFieldRead }
  bounce?: Pick<WebgpuPagesRuntime['bounce'], 'probes'>
}

/** The reflection group's other resource: the lighting's view. Undefined while the lighting is not made. */
export const reflectionLightView = ({ gpu }: ReflectionHost) => gpu.deferred?.uniform

/** The global distance field the scene stage marches its rays through: the session's, else the stand-in of a scene
 *  that has none, a view block that holds no clipmap; undefined while the lighting is not made. */
export const reflectionField = ({ gpu, distanceFields }: ReflectionHost) =>
  distanceFields?.scene ?? gpu.deferred?.placeholders.distanceField

/** Binds, in the forward `pass`, the reflection group (`REFLECTION_GROUP`): the view's reflection as the forward programs read it
 *  (`forwardReflectionGroup`). */
export function bindForwardReflection(
  pass: GPURenderPassEncoder,
  rt: ReflectionHost,
  sky: SkyLightReadSet,
) {
  const lightView = reflectionLightView(rt),
    depth = rt.vis.gpuHiz?.depth()
  if (rt.gpu.reflection && lightView && depth)
    pass.setBindGroup(
      REFLECTION_GROUP,
      forwardReflectionGroup(
        rt.gpu.reflection,
        depth,
        lightView,
        sky,
        forwardSceneResources(rt.gpu.reflection, rt),
      ),
    )
}
