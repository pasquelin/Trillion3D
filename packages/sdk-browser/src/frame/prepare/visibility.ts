import { createReflectionPipelines } from '../../lighting/reflections/reflectionPipelines.ts'
import { surfaceCacheLightOf } from '../../lighting/surfaceCache/light.ts'
import { createWebgpuVisibilityShaders } from '../../visibility/passes/shaders.ts'
import { NO_RASTERS, graphRastersOf } from '../../materials/graph/graphRasters.ts'
import { grantsVertexTextures } from '../../gpu/core/vertexTextures.ts'
import { cameraMasks } from '../../visibility/shader/maskSets.ts'
import { visibilityWpo } from '../../visibility/shader/wpoSets.ts'
import { visUniformSlots } from '../../visibility/passes/uniforms.ts'
import { MAX_DEPTH_LAYER } from '../../../../sdk-core/src/lod/depthLayer.ts'
import { createGpuHiz } from '../../visibility/hiz/gpu/factory.ts'
import { validated } from '../../gpu/core/errorScope.ts'
import { prepareTransparentOcclusion } from '../../blend/transparent/occlusionHost.ts'
import { askVisibleStages } from '../render/visibleTables.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { frameSizeOf, type FrameSize } from '../backend/state/renderScale.ts'
import {
  bindShade,
  prepareBlendPipelines,
  prepareRasterPipelines,
  prepareShadeClasses,
} from './visibilitySteps.ts'

/** The coplanar layer slots `pages` ask: one more than the deepest layer they carry, 1 for none. */
export function depthLayerSlots(pages: readonly { depthLayer: number }[]) {
  let deepest = 0
  for (const rec of pages) if (rec.depthLayer > deepest) deepest = rec.depthLayer
  return 1 + Math.min(deepest, MAX_DEPTH_LAYER)
}

/**
 * Holds the graph outputs the session's modules are made with: the cutouts and the offsets of the
 * programs its surfaces' graphs wear (`graphRastersOf`), the device saying whether an offset may read
 * a texture (`grantsVertexTextures`), at the very start of the preparation, so
 * that the temporal pass, which is made before the visibility programs, holds the same ones
 * (`WebgpuVisState.rasters`).
 */
export function holdGraphRasters(rt: WebgpuPagesRuntime, device: GPUDevice) {
  rt.vis.rasters = graphRastersOf(
    rt.setup.allPages.map((rec) => rec.material),
    {
      ...NO_RASTERS,
      textures: grantsVertexTextures(device),
    },
  )
}

/** Builds the blend pipelines, the visibility raster and shade pipelines and the Hi-Z pyramid; throws
 *  by name when one of them cannot be made: the visibility pass is the one image (#1483). */
export async function prepareWebgpuVisibility(rt: WebgpuPagesRuntime, gpuDevice: GPUDevice) {
  const { vis } = rt
  await prepareBlendPipelines(rt, gpuDevice)
  // Coplanar depth sets draw slots before visibility uniforms and the bins.
  vis.drawLayerSlots = depthLayerSlots(rt.setup.allPages)
  const variant = rt.context?.diagnosticGpuVariant
  // The masks and the offsets the surfaces' graphs wire were held at the start of the preparation
  // (`holdGraphRasters`), before the first raster is made.
  const masks = cameraMasks(vis.rasters)
  const wpo = visibilityWpo(vis.rasters)
  const shaders = await createWebgpuVisibilityShaders(
    gpuDevice,
    visUniformSlots(vis),
    variant,
    rt.setup.clipping,
    masks,
    wpo,
  )
  vis.shadeUniform = shaders.shadeUniform
  vis.visBindGroupLayout = shaders.visBindGroupLayout
  vis.zeroRows = shaders.zeroRows
  vis.visUniform = shaders.visUniform
  await createHizFor(rt, gpuDevice)
  await prepareRasterPipelines(rt, gpuDevice, shaders, variant)
  const classes = await prepareShadeClasses(rt, gpuDevice, shaders, variant)
  await bindShade(rt, gpuDevice, shaders, classes)
  await prepareDrawPath(rt, gpuDevice)
  // Transparent occlusion last: it borrows the pyramid.
  await prepareTransparentOcclusion(rt, gpuDevice)
}

/** Hi-Z is the one occlusion path (#1483): a device that cannot hold its pyramid at the size the
 *  frame is drawn at — the view's pixels at the render scale (`frameSizeOf`), the targets' own,
 *  never the drawing buffer's — refuses the scene by name, as one that cannot build the raster that
 *  writes it. */
async function createHizFor(rt: WebgpuPagesRuntime, gpuDevice: GPUDevice) {
  const { renderWidth, renderHeight } = frameSizeOf(rt, {} as FrameSize)
  const hiz = await createGpuHiz(gpuDevice, 1, 1)
  const size = () => hiz?.resize(gpuDevice, renderWidth, renderHeight) || undefined
  if (!hiz || !(await validated(gpuDevice, size, 'out-of-memory'))) {
    hiz?.dispose()
    throw new Error('WEBGPU_HIZ_UNAVAILABLE')
  }
  rt.vis.gpuHiz = hiz
  // The reflections march its pyramid, the whole depth: their kernels come with it, or the scene
  // is refused.
  rt.vis.reflectionPipelines = await createReflectionPipelines(
    gpuDevice,
    rt.setup.reflectionStatistics,
    surfaceCacheLightOf(rt, gpuDevice),
  )
  if (!rt.vis.reflectionPipelines) throw new Error('WEBGPU_REFLECTIONS_UNAVAILABLE')
}

/** The decode and the bins are the one draw path: a device that refuses a stage of them refuses the
 *  scene, since nothing else would draw it. */
async function prepareDrawPath(rt: WebgpuPagesRuntime, gpuDevice: GPUDevice) {
  askVisibleStages(rt, gpuDevice)
  const { gpuDecode, binStages } = rt.vis
  try {
    await Promise.all([gpuDecode!.prepare(), binStages!.prepare()])
  } catch {
    throw new Error('WEBGPU_DRAW_UNAVAILABLE')
  }
}
