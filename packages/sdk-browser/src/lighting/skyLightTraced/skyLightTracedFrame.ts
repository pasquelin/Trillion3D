import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { RAY_TRACED_SHADOW_VIEW_RULES } from '../../../../sdk-core/src/contracts/rayTracedShadowOptions.ts'
import { contextReader } from '../../../../sdk-core/src/contracts/settingRules.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import { dagReadGroupEntries } from '../../geometry/dag/shader/bindings.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { viewKey } from '../../frame/backend/state/viewKey.ts'
import { imagesSinceChange } from '../../frame/render/noiseFrame.ts'
import { skyLightReadOf, skyLightStateOf } from '../../frame/render/skyLightState.ts'
import { groupFor } from '../../gpu/bind/cachedGroup.ts'
import { dispatchOn } from '../../gpu/core/computeStages.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import { preExposureOf } from '../../post/exposure/pre.ts'
import { chainReady } from '../deferred/fullscreen.ts'
import { skyTableSize } from '../pathTracing/skyWgsl.ts'
import { reflectionLightView } from '../reflections/group.ts'
import { hizLevelZeroBindEntries } from '../../visibility/hiz/gpu/pyramidTexture.ts'
import { skyLightDiffuseBindEntries } from '../../modules/sky/skyLight/read.ts'
import { heldDirectLightResources } from '../../frame/prepare/contractLight.ts'
import {
  REFLECTION_DEPTH_BINDING,
  REFLECTION_LIGHT_VIEW_BINDING,
  REFLECTION_SKY_LIGHT,
  REFLECTION_VIEW_BINDING,
} from '../reflections/viewLayout.ts'
import { isPending, isReady } from '../rays/sceneTrace/sceneMaskHold.ts'
import { createSkyTable } from '../skyTable/skyTable.ts'
import { encodeSkyTable } from '../skyTable/skyTableEncode.ts'
import { skyTableStagesOf } from '../skyTable/skyTableStages.ts'
import { sceneRaysOf, type SceneRays } from '../surfaceCache/lighting/surfaceLighting.ts'
import {
  encodeSkyLightDenoise,
  skyLightImageWeight,
  skyLightSettlingImages,
} from './skyLightTracedDenoise.ts'
import {
  skyLightHairVoxels,
  skyLightTracedAsk,
  skyLightTracedCounts,
  skyLightTracedSettings,
  skyLightTracedWanted,
} from './skyLightTracedGate.ts'
import { skyLightTracedKit } from './skyLightTracedKit.ts'
import {
  releaseSkyLightTraced,
  skyLightRuns,
  skyLightTracedViewOf,
  skyLightViewOf,
} from './skyLightTracedState.ts'
import {
  SKY_COMPOSITE_BINDINGS as C,
  SKY_RAYS_BINDINGS as R,
  SKY_RAYS_GROUP,
  SKY_RAYS_SIDE,
  SKY_TRACE_BINDINGS as T,
  SKY_TRACE_GROUP,
  SKY_TRACE_HAIR as H,
  SKY_TRACE_SCENE,
} from './skyLightTracedWgsl.ts'
import { SKY_MODEL_BINDINGS as M } from './skyLightTracedModelWgsl.ts'

/** Centimetres in a metre: the settings are in centimetres, the scene's lengths in metres. */
const CM = 0.01
/** The least normal bias, in centimetres, and the least offset of a ray's start off the surface, in metres (the same length). */
const LEAST_BIAS_CM = 0.01
const LEAST_START = 0.0001

const readShadow = contextReader(RAY_TRACED_SHADOW_VIEW_RULES)

/** What an image lights the sky by rays with, found once the lighting made its scene trace: that trace and the compiled stage of the rays over the graph masks it holds. */
interface SkyLightTracedPlan {
  readonly frame: number
  readonly rays: SceneRays
  readonly pipeline: GPUComputePipeline
  /** The strands' voxels the pipeline marches the rays through (`skyLightHairVoxels`), none for the pipeline that does not. */
  readonly hair: ReturnType<typeof skyLightHairVoxels>
  /** The lit image the composite adds to and the lighting's view the trace reads, held so that the encode finds both where the plan found them. */
  readonly hdrView: GPUTextureView
  readonly lightView: GPUBuffer
}

/** The plan of each view's image: the wanted test reads the active view, so the plan is the view's. */
const plans = new WeakMap<object, SkyLightTracedPlan>()

/**
 * The plan of this image, none while the sky is lit by the harmonics: the settings and the sky light want the rays (`skyLightTracedWanted`), the lighting made a scene trace for the image,
 * the view holds its surfaces, depth pyramid, reflection state, lit image and lighting view, and every pipeline the rays go through (the sky's table included) is compiled. It is decided once an image
 * for each view, where the scene trace is there, and everything the encode needs is decided here: the cut of the sky light's diffuse (`skyLightDiffuseTraced`) and the rays that replace it
 * are one decision, so that the encode never stops after the indirect pass cut the diffuse.
 */
function skyLightTracedPlan(rt: WebgpuPagesRuntime): SkyLightTracedPlan | undefined {
  const key = viewKey(rt.gpu)
  const held = plans.get(key)
  if (held?.frame === rt.run.frame) return held
  const { device, hdrView } = rt.gpu
  const settings = skyLightTracedSettings(rt)
  if (!device || !hdrView || !skyLightTracedWanted(rt, settings)) return undefined
  const lightView = reflectionLightView(rt)
  const rays = sceneRaysOf(rt.surfaceCache?.lighting, rt.run.frame)
  if (!lightView || !rays || !rt.gpu.reflection || !rt.gpu.surfaces || !rt.vis.gpuHiz?.depth())
    return undefined
  // The pixel's shading model is read from the light buffer and the toon buffer the lit passes read this image.
  const { lights, toonTables } = heldDirectLightResources()
  if (!lights || !toonTables) return undefined
  const kit = skyLightTracedKit(device)
  const hair = skyLightHairVoxels(rt, device, settings)
  const pipeline = rays.sceneTrace.maskHold
    .use(
      'ray traced sky light',
      hair ? 'hair voxels' : '',
      hair ? kit.hairStageOf : kit.stageOf,
      isReady,
      isPending,
    )
    ?.kernel.get()
  const tables = Object.values(skyTableStagesOf(device).stages)
  if (!pipeline || !chainReady(kit.directions, kit.additive, ...tables)) return undefined
  const plan = { frame: rt.run.frame, rays, pipeline, hair, hdrView, lightView }
  plans.set(key, plan)
  return plan
}

/** Whether the traced light replaces the sky light's diffuse this image: the indirect pass cuts the diffuse, and the composite adds the rays' in its place. */
export const skyLightDiffuseTraced = (rt: WebgpuPagesRuntime) => !!skyLightTracedPlan(rt)

/** Whether the view's sky light still builds its temporal history: the last image denoised with accumulation, and fewer images than it takes the history to settle were drawn since the view changed. */
export function skyLightTracedSettling(rt: WebgpuPagesRuntime) {
  const view = skyLightViewOf(rt.gpu)
  return !!view?.accumulates && imagesSinceChange(rt.run) < skyLightSettlingImages(view.imageWeight)
}

/** The sky's table of the view, made at the cube's size and built from the cube again when the light's words moved (the real-time capture's layer, the colour). False while a pipeline compiles. */
function skyTableOf(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  view: NonNullable<ReturnType<typeof skyLightViewOf>>,
) {
  const { uniform } = skyLightStateOf(rt)
  // The uniform's fifth word is the cube's last mip: its side is two to that power.
  const side = skyTableSize(2 ** uniform[5]!, device.limits.maxTextureDimension2D)
  if (view.table?.size !== side) {
    if (view.table) retire(device, view.table)
    view.table = createSkyTable(device, side, 'Trillion3D sky light')
    view.tableKey = ''
  }
  const key = uniform.join(',')
  if (view.tableKey === key) return view.table
  // The reference builds it with the MIS compensation always on.
  if (
    !encodeSkyTable(
      device,
      encoder,
      view.table,
      skyLightReadOf(rt),
      true,
      'Trillion3D sky light table',
    )
  )
    return undefined
  view.tableKey = key
  return view.table
}

/**
 * THE RAY-TRACED SKY LIGHT of this image, after the lit pass (the reference runs it after the subsurface pass): the sky's table built from the light's cube, the directions of the rays drawn
 * once in their table where the generation is decoupled, the trace over the view's pixels (one a cell of `upscale` pixels, a different one of the cell each image), the denoiser, and the
 * composite that adds the light times the pixels' diffuse colour into the lit image. Does nothing unless `skyLightDiffuseTraced` said so this image, in which case the indirect pass cut the sky's
 * diffuse; the resources of a view that stopped lighting the sky this way are let go.
 */
export function encodeSkyLightTraced(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
) {
  const plan = plans.get(viewKey(rt.gpu))
  if (plan?.frame !== rt.run.frame) {
    // A view that no longer wants the rays lets its resources go; one that wants them while a pipeline compiles keeps them (and its denoiser's history).
    if (!skyLightTracedWanted(rt)) releaseSkyLightTraced(rt.gpu)
    return
  }
  const { surfaces, reflection } = rt.gpu
  const { lights, toonTables } = heldDirectLightResources()
  const hiz = rt.vis.gpuHiz?.depth()
  if (!surfaces || !reflection || !hiz || !lights || !toonTables) return
  const { hdrView, lightView } = plan
  const settings = skyLightTracedSettings(rt)
  const counts = skyLightTracedCounts(rt, device, SKY_RAYS_SIDE, settings)
  const decoupled = settings.rayTracedSkyLightDecoupleSampleGeneration
  const [width, height] = rt.gpu.targetSize
  const view = skyLightTracedViewOf(
    rt,
    device,
    width,
    height,
    counts.upscale,
    counts.samples,
    decoupled,
  )
  const table = skyTableOf(rt, device, encoder, view)
  if (!table) return
  const kit = skyLightTracedKit(device)
  const { ints, floats } = kit
  const { uniforms, groups } = skyLightRuns.of(viewKey(rt.gpu), device)
  const frame = rt.run.frame
  // The groups of the passes that read the parameters take a slot of the pool and write the words into it; the others bind none.
  const run = (
    name: string,
    layout: GPUBindGroupLayout,
    deps: unknown[],
    make: (params: GPUBuffer) => GPUBindGroupEntry[],
  ) => {
    const params = uniforms.next(device, encoder)
    device.queue.writeBuffer(params.buffer, 0, kit.words)
    return groupFor(
      device,
      groups,
      `${name}${params.index}`,
      layout,
      [params.buffer, ...deps],
      () => make(params.buffer),
    )
  }
  const bind = (
    name: string,
    layout: GPUBindGroupLayout,
    deps: unknown[],
    make: () => GPUBindGroupEntry[],
  ) => groupFor(device, groups, name, layout, deps, make)

  if (decoupled) {
    ints.fill(0)
    ints.set([0, 0, counts.samples, frame])
    const group = run(
      'rays',
      kit.rays,
      [view.rays, table.radianceView, table.pdfView],
      (buffer) => [
        { binding: R.params, resource: { buffer } },
        { binding: R.rays, resource: { buffer: view.rays } },
        { binding: R.skyTexture, resource: table.radianceView },
        { binding: R.skyPdf, resource: table.pdfView },
      ],
    )
    const pass = encoder.beginComputePass({ label: 'Trillion3D sky light directions' })
    const groups16 = ceilDiv(SKY_RAYS_SIDE, SKY_RAYS_GROUP)
    dispatchOn(pass, kit.directions, group, groups16, groups16)
    pass.end()
  }

  const [cellsX, cellsY] = view.cells
  ints.fill(0)
  ints.set([width, frame, counts.samples, counts.upscale], 0)
  ints.set([0, 0, cellsX, cellsY], 4)
  floats.set(
    [
      settings.rayTracedSkyLightMaxRayDistance * CM,
      0,
      Math.max(readShadow(rt, 'rayTracedShadowsNormalBias'), LEAST_BIAS_CM) * CM,
      preExposureOf(rt).now,
    ],
    8,
  )
  ints.set(
    [
      decoupled ? 1 : 0,
      settings.rayTracedSkyLightTwoSidedGeometry ? 1 : 0,
      settings.rayTracedSkyLightMaterials ? 1 : 0,
      frame,
    ],
    12,
  )
  const hairVoxels = plan.hair
  floats.set(
    [
      LEAST_START,
      settings.rayTracedSkyLightMaxShadowThickness * CM,
      hairVoxels?.density ?? 0,
      hairVoxels?.stepping ?? 1,
    ],
    16,
  )
  ints.set([skyLightTracedAsk(rt)?.transmission ? 1 : 0, hairVoxels?.jitter ?? 0, 0, 0], 20)
  floats[22] = hairVoxels?.occlusion ?? 1
  const { nodes, frames, worlds, tree } = plan.rays.views
  const trace = run(
    'trace',
    kit.trace,
    [
      surfaces.views()[1],
      surfaces.views()[3],
      surfaces.views()[0],
      surfaces.views()[2],
      surfaces.subsurfaceView,
      lights,
      toonTables,
      view.lightView,
      view.openView,
      view.rays,
      table.radianceView,
      table.pdfView,
      nodes,
      frames,
      worlds,
      tree,
    ],
    (buffer) => [
      { binding: T.params, resource: { buffer } },
      { binding: T.normals, resource: surfaces.views()[1]! },
      { binding: T.flags, resource: surfaces.views()[3]! },
      { binding: M.base, resource: surfaces.views()[0]! },
      { binding: M.emissiveAo, resource: surfaces.views()[2]! },
      { binding: M.subsurface, resource: surfaces.subsurfaceView },
      { binding: M.lights, resource: { buffer: lights } },
      { binding: M.toon, resource: { buffer: toonTables } },
      { binding: T.light, resource: view.lightView },
      { binding: T.open, resource: view.openView },
      { binding: T.rays, resource: { buffer: view.rays } },
      { binding: T.skyTexture, resource: table.radianceView },
      { binding: T.skyPdf, resource: table.pdfView },
      ...dagReadGroupEntries(plan.rays.views),
    ],
  )
  const pass = encoder.beginComputePass({ label: 'Trillion3D sky light trace' })
  pass.setPipeline(plan.pipeline)
  pass.setBindGroup(0, trace)
  const skyRead = skyLightReadOf(rt)
  const viewGroup = bind(
    'view',
    kit.view,
    [reflection.uniform, hiz, lightView, skyRead.harmonics, skyRead.params],
    () => [
      { binding: REFLECTION_VIEW_BINDING, resource: { buffer: reflection.uniform } },
      ...hizLevelZeroBindEntries(REFLECTION_DEPTH_BINDING, hiz),
      { binding: REFLECTION_LIGHT_VIEW_BINDING, resource: { buffer: lightView } },
      ...skyLightDiffuseBindEntries(REFLECTION_SKY_LIGHT, skyRead),
    ],
  )
  pass.setBindGroup(1, viewGroup)
  pass.setBindGroup(
    SKY_TRACE_SCENE.group,
    kit.sceneGroup(kit.scene, plan.rays.sceneTrace, SKY_TRACE_SCENE.first),
  )
  if (hairVoxels) {
    const { set } = hairVoxels
    pass.setBindGroup(
      H.group,
      bind('hair', kit.voxels, [set.paramsBuffer, set.nodes, set.pageIndex, set.voxels], () => [
        { binding: H.params, resource: { buffer: set.paramsBuffer } },
        { binding: H.nodes, resource: { buffer: set.nodes } },
        { binding: H.pageIndex, resource: { buffer: set.pageIndex } },
        { binding: H.voxels, resource: { buffer: set.voxels } },
      ]),
    )
  }
  pass.dispatchWorkgroups(ceilDiv(cellsX, SKY_TRACE_GROUP), ceilDiv(cellsY, SKY_TRACE_GROUP), 1)
  pass.end()

  const denoised = encodeSkyLightDenoise(rt, device, encoder, cam, view, settings)
  view.accumulates = denoised.accumulates
  view.imageWeight = skyLightImageWeight(settings, counts.samples)

  // The denoiser's colour is at the full resolution; the rays' own light is read at the cell of the pixel.
  const sky = denoised.view ?? view.lightView
  ints.fill(0)
  floats.set([denoised.view ? 1 : counts.upscale, 0, 0, 0], 0)
  const composite = run(
    'composite',
    kit.composite,
    [sky, surfaces.views()[0], surfaces.views()[3]],
    (buffer) => [
      { binding: C.sky, resource: sky },
      { binding: C.base, resource: surfaces.views()[0]! },
      { binding: C.params, resource: { buffer } },
      { binding: C.flags, resource: surfaces.views()[3]! },
    ],
  )
  const draw = encoder.beginRenderPass({
    label: 'Trillion3D sky light composite',
    colorAttachments: [{ view: hdrView, loadOp: 'load', storeOp: 'store' }],
  })
  draw.setPipeline(kit.additive.get()!)
  draw.setBindGroup(0, composite)
  draw.draw(3)
  draw.end()
}
