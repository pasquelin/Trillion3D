import { readSingleLayerWaterSetting } from '../../../../sdk-core/src/contracts/singleLayerWaterOptions.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { litBlendPipelines } from '../draw.ts'
import type { ContractKey } from '../../lighting/deferred/contractCuts.ts'
import type { PreparedPipeline } from '../../lighting/deferred/fullscreen.ts'
import type { WaterPipelines } from './waterPipelines.ts'
import { waterScenePipelines } from './waterSceneStages.ts'
import {
  waterSceneGroups,
  waterSeparated,
  waterTargetsOf,
  writeWaterParams,
  type WaterSettings,
  type WaterTargets,
} from './waterTargets.ts'

/** Whether the image draws water: the setting is on, the plan holds a water item and the program
 *  has the pipelines for it. */
const drawsWater = (rt: WebgpuPagesRuntime) =>
  rt.blendState.water &&
  readSingleLayerWaterSetting(rt, 'singleLayerWater') &&
  !!rt.vis.blendPipelines &&
  !!rt.blendState.runCount

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
  /** The refraction is masked. */
  masked: boolean
  /** The tiles that hold water are listed, for the colour copy or the composite. */
  listed: boolean
  /** The colour copy and the composite are drawn over the listed tiles alone. */
  tiledCopy: boolean
  tiledComposite: boolean
  /** The extent the depth is copied over. */
  extent: [number, number]
}

/** Which passes run over the tiles that hold water: they are known from the water's depth, so only with the
 *  depth pass; `copyable` whether the colour copy may be tiled, `composited` whether the composite is drawn. */
function tilingOf(
  settings: WaterSettings,
  prepass: boolean,
  copyable: boolean,
  composited: boolean,
) {
  const copiesTiled = settings.singleLayerWaterTiledSceneColorCopy && copyable
  const compositeTiled = settings.singleLayerWaterTiledComposite && composited
  const listed = prepass && (copiesTiled || compositeTiled)
  return { listed, tiledCopy: listed && copiesTiled, tiledComposite: listed && compositeTiled }
}

/** The frame of water of this image, or none where the image draws no water or lacks what it needs. */
export function openWaterFrame(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  key?: Partial<ContractKey>,
): WaterFrame | undefined {
  if (!drawsWater(rt)) return undefined
  const { gpu, blendState } = rt
  const pipelines = litBlendPipelines(rt, device, key)?.water
  if (!pipelines || !gpu.hdrView || !gpu.depthView || !gpu.depthTexture || !blendState.argsBuffer)
    return undefined
  const targets = waterTargetsOf(rt, device)
  // The settings of the image, one reading; the sun kept apart where the programs hold it and a setting asks.
  const settings = targets.watch.read(rt.context)
  const separated = pipelines.separate && !!waterSeparated(settings, !!rt.distanceFields)
  const masked = writeWaterParams(rt, device, targets, settings, separated)
  const [width, height] = gpu.targetSize
  const prepass = settings.singleLayerWaterDepthPrepass
  const reflects = settings.singleLayerWaterReflection !== 'disabled'
  const tiling = tilingOf(settings, prepass, masked && targets.factor === 1, reflects || separated)
  return {
    rt,
    device,
    encoder,
    hdrView: gpu.hdrView,
    depthView: gpu.depthView,
    depthTexture: gpu.depthTexture,
    pipelines,
    targets,
    stages: waterScenePipelines(device),
    scene: waterSceneGroups(device, targets, gpu.hdrView, gpu.depthView),
    settings,
    width,
    height,
    prepass,
    reflects,
    separated,
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
    ...(f.listed ? [stages.marks, stages.lists] : []),
    ...(f.masked && f.prepass ? [stages.mask.pipeline] : []),
    ...(f.rt.gpu.velocity?.measured && f.rt.vis.visView ? [stages.ids] : []),
    ...f.pipelines.chain({
      prepass: f.prepass,
      composite: f.reflects || f.separated ? f.tiledComposite : undefined,
    }),
  ]
}
