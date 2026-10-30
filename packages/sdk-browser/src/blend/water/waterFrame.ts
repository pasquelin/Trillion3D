import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { litBlendPipelines } from '../draw.ts'
import type { ContractKey } from '../../lighting/deferred/contractCuts.ts'
import type { PreparedPipeline } from '../../lighting/deferred/fullscreen.ts'
import type { WaterPipelines } from './waterPipelines.ts'
import { waterScenePipelines } from './waterSceneStages.ts'
import {
  forwardFieldSun,
  type ForwardFieldSun,
} from '../../lighting/shadows/classic/fieldShadow/fieldShadowWater.ts'
import { releaseFieldWaterMask } from '../../lighting/shadows/classic/fieldShadow/fieldShadowKit.ts'
import { waterExclusionsOf } from './waterExclusions.ts'
import { waterSunLayer } from '../../lighting/shadows/vsm/frame/vsmWaterSun.ts'
import {
  waterFiltersField,
  waterFiltersSun,
  waterSceneGroups,
  waterSeparated,
  waterTargetsOf,
  waterWanted,
  writeWaterParams,
  type WaterSettings,
  type WaterTargets,
} from './waterTargets.ts'

/** Whether the image draws water: the setting is on, the plan holds a water item and the program
 *  has the pipelines for it. */
const drawsWater = (rt: WebgpuPagesRuntime) =>
  waterWanted(rt) && !!rt.vis.blendPipelines && !!rt.blendState.runCount

/** Everything the passes of one image of water share: the runtime, the encoder, the scene's targets, the
 *  water's own targets, programs and groups, the settings read once, and the choices they make. */
export interface WaterFrame {
  rt: WebgpuPagesRuntime
  device: GPUDevice
  encoder: GPUCommandEncoder
  hdrView: GPUTextureView
  depthView: GPUTextureView
  depthTexture: GPUTexture
  pipelines: WaterPipelines
  /** The groups that name the exclusion volumes' table, in the variant of the programs for a world that holds some (`waterExclusionsOf`). */
  exclusions: ReturnType<typeof waterExclusionsOf> | undefined
  targets: WaterTargets
  stages: ReturnType<typeof waterScenePipelines>
  scene: ReturnType<typeof waterSceneGroups>
  settings: WaterSettings
  width: number
  height: number
  /** The water's depth is drawn before the shading (`singleLayerWaterDepthPrepass`). */
  prepass: boolean
  /** The reflection composite is drawn: the water reflects something. */
  reflects: boolean
  /** The sun is kept apart from the shading. */
  separated: boolean
  /** The layer of the projection's mask that holds the forward sun, where the sun's shadow on the water is the projection's
   *  (`singleLayerWaterVsmFiltering`) and the image projects it; −1 else. */
  sunLayer: number
  /** The layer of the field mask that holds the forward sun, where the sun's shadow on the water is the classic distance-field cascade's
   *  (`singleLayerWaterDistanceFieldShadow`) and the image traced it; −1 else. */
  fieldSunLayer: number
  /** The forward sun's field shadow, resolved once for the image (`fieldSunLayer` is its layer), none where `fieldSunLayer` is −1. */
  fieldSun: ForwardFieldSun | undefined
  /** The refraction is masked. */
  masked: boolean
  /** The tiles that hold water are listed, for the colour copy, the composite or the sun's shadow. */
  listed: boolean
  /** The colour copy and the composite are drawn over the listed tiles alone. */
  tiledCopy: boolean
  tiledComposite: boolean
  /** The extent the depth is copied over. */
  extent: [number, number]
}

/** Which passes run over the tiles that hold water, listed from the water's depth (before the shading with the
 *  depth pass, after it without); `copyable` whether the colour copy may be tiled, `composited` whether the composite is drawn,
 *  `shadowed` whether the sun's shadow is projected over them. */
function tilingOf(
  settings: WaterSettings,
  prepass: boolean,
  copyable: boolean,
  composited: boolean,
  shadowed: boolean,
) {
  const copiesTiled = settings.singleLayerWaterTiledSceneColorCopy && copyable
  const compositeTiled = settings.singleLayerWaterTiledComposite && composited
  // Without the depth pass the list is made once the water is shaded: the colour copy before it cannot use it.
  const listed = shadowed || compositeTiled || (prepass && copiesTiled)
  return { listed, tiledCopy: listed && prepass && copiesTiled, tiledComposite: compositeTiled }
}

/** The frame of water of this image, or none where the image draws no water or lacks what it needs. */
export function openWaterFrame(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  key?: Partial<ContractKey>,
): WaterFrame | undefined {
  if (!drawsWater(rt)) {
    releaseFieldWaterMask(rt.gpu)
    return undefined
  }
  const { gpu, blendState } = rt
  const pipelines = litBlendPipelines(rt, device, key)?.water
  if (!pipelines || !gpu.hdrView || !gpu.depthView || !gpu.depthTexture || !blendState.argsBuffer) {
    releaseFieldWaterMask(gpu)
    return undefined
  }
  const targets = waterTargetsOf(rt, device)
  // The settings of the image, one reading; the sun kept apart where the programs hold it and a setting asks.
  const settings = targets.watch.read(rt.context)
  const separated = pipelines.separate && !!waterSeparated(settings, !!rt.distanceFields)
  const prepass = settings.singleLayerWaterDepthPrepass
  // The sun's shadow is projected over the listed tiles (from the water's depth, before or after the shading).
  const sunLayer = separated && waterFiltersSun(settings) ? waterSunLayer(rt, device) : -1
  const fieldSun =
    separated && waterFiltersField(settings, !!rt.distanceFields)
      ? forwardFieldSun(rt, device)
      : undefined
  // Both masks are read at the one layer of the water's uniform (`filters.z`): the field cascade is traced into the layer the projection's mask holds the forward sun at,
  // else the sun's own rank in the frame's projected suns, so a cascade whose rank differs from the projection's is still laid.
  const fieldSunLayer = fieldSun ? (sunLayer >= 0 ? sunLayer : fieldSun.entry.layer) : -1
  // The water's sun mask lives only while the water uses the field shadow.
  if (!fieldSun) releaseFieldWaterMask(rt.gpu)
  // Both masks have a layer a sun of the frame, so the one layer names the forward sun in either. Only the projection of the shadow maps
  // replaces the water's own shadow of the sun: the distance-field mask is multiplied on top of the water's own cascades.
  const masked = writeWaterParams(rt, device, targets, settings, separated, {
    layer: fieldSunLayer >= 0 ? fieldSunLayer : sunLayer,
    projected: sunLayer >= 0,
  })
  const [width, height] = gpu.targetSize
  const reflects = settings.singleLayerWaterReflection !== 'disabled'
  const tiling = tilingOf(
    settings,
    prepass,
    masked && targets.factor === 1,
    reflects || separated,
    sunLayer >= 0 || fieldSunLayer >= 0,
  )
  return {
    rt,
    device,
    encoder,
    hdrView: gpu.hdrView,
    depthView: gpu.depthView,
    depthTexture: gpu.depthTexture,
    pipelines,
    exclusions: pipelines.exclusion ? waterExclusionsOf(rt, device, targets) : undefined,
    targets,
    stages: waterScenePipelines(device),
    scene: waterSceneGroups(device, targets, gpu.hdrView, gpu.depthView),
    settings,
    width,
    height,
    prepass,
    reflects,
    separated,
    sunLayer,
    fieldSunLayer,
    fieldSun,
    masked,
    ...tiling,
    // The depth is copied over the view alone (`singleLayerWaterOptimizedClear`), else over the whole texture.
    extent: settings.singleLayerWaterOptimizedClear
      ? [width, height]
      : [targets.waterDepth.width, targets.waterDepth.height],
  }
}

/** Every pipeline the passes of `f` bind: the scene's depth copy, the tiles' kernels where listed,
 *  the colour copy, the mask, the water's (`WaterPipelines.chain`). */
export function waterChain(f: WaterFrame): PreparedPipeline<unknown>[] {
  const { stages } = f
  return [
    stages.depthCopy.pipeline,
    f.tiledCopy ? stages.colorTiled.pipeline : stages.color.pipeline,
    ...(f.listed ? [stages.marks, stages.lists, stages.dispatch] : []),
    ...(f.sunLayer >= 0 || f.fieldSunLayer >= 0 ? [stages.sunShadow.pipeline] : []),
    ...(f.masked && f.prepass ? [stages.mask.pipeline] : []),
    ...(f.rt.gpu.velocity?.measured && f.rt.vis.visView ? [stages.ids] : []),
    ...f.pipelines.chain({
      prepass: f.prepass,
      composite: f.reflects || f.separated ? f.tiledComposite : undefined,
    }),
  ]
}
