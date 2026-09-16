import { createWebgpuBlendPipelines } from './webgpuBlendPipelines.ts';
import { createWebgpuVisibilityShaders } from './webgpuVisibilityShaders.ts';
import {
  createWebgpuCoplanarLayerPipelines,
  createWebgpuShadePipeline,
  createWebgpuVisibilityRasterPipelines,
} from './webgpuVisibilityPipelines.ts';
import { visUniformSlots } from './webgpuVisibilityUniforms.ts';
import { shadeBindEntries } from './webgpuBindEntries.ts';
import { MAX_DEPTH_LAYER, depthLayerBias } from '../sdk-core/index.ts';
import { createGpuHiz } from './gpuHiz.ts';
import { createGpuDraw } from './gpuDraw.ts';
import { createGpuPartition } from './gpuPartitionFactory.ts';
import { prepareTransparentOcclusion } from './webgpuTransparentOcclusionHost.ts';
import { PAGE_INFO_STRIDE } from './visibilityBuffer.ts';
import { SURFACE_FORMATS } from './surfaceBuffer.ts';
import { dropGpuHiz, dropVis, grantCapability } from './webgpuPagesDrops.ts';
import { VIS_FEATURES, type WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** Builds the forward material pipelines, the visibility raster and shade pipelines, the Hi-Z
 *  pyramid and the indirect draw; leaves `visEnabled` telling whether the image can use them. */
export async function prepareWebgpuVisibility(rt: WebgpuPagesRuntime, gpuDevice: GPUDevice) {
  const { vis, gpu, capabilities, diag, blendState } = rt,
    { drawSlots } = rt.layout,
    [width, height] = rt.setup.viewport;
  try {
    ({
      blendBindGroupLayout: vis.blendBindGroupLayout,
      pipelineBlendTextured: vis.pipelineBlendTextured,
      pipelineBlendFront: vis.pipelineBlendFront,
      pipelineBlendBack: vis.pipelineBlendBack,
    } = await createWebgpuBlendPipelines(
      gpuDevice,
      blendState.blendGpu,
      rt.context.diagnosticGpuVariant,
    ));
  } catch (error) {
    diag.diagnosticFailure('forward-material-pipeline-failed', error);
    vis.blendBindGroupLayout = undefined;
    vis.pipelineBlendTextured = undefined;
  }
  // La profondeur de l'empilement coplanaire fixe le nombre de slots de dessin, donc la taille de
  // l'uniforme de visibilité et celle de la compaction indirecte : elle se lit avant de les créer.
  let maxDepthLayer = 0;
  for (const rec of rt.setup.allPages)
    if (rec.depthLayer > maxDepthLayer) maxDepthLayer = rec.depthLayer;
  vis.drawLayerSlots = 1 + Math.min(maxDepthLayer, MAX_DEPTH_LAYER);
  const shaders = await createWebgpuVisibilityShaders(gpuDevice, drawSlots, visUniformSlots(vis));
  vis.shadeUniform = shaders.shadeUniform;
  vis.visBindGroupLayout = shaders.visBindGroupLayout;
  vis.zeroFlags = shaders.zeroFlags;
  vis.visUniform = shaders.visUniform;
  const { visModule, shadeModule } = shaders;
  vis.gpuHiz = await createGpuHiz(gpuDevice, Math.max(1, width), Math.max(1, height), drawSlots);
  let rasterPipelines;
  try {
    if (!vis.gpuHiz || !vis.visBindGroupLayout) throw new Error('HIZ_UNAVAILABLE');
    rasterPipelines = await createWebgpuVisibilityRasterPipelines(
      gpuDevice,
      visModule,
      vis.visBindGroupLayout,
      true,
    );
  } catch (error) {
    diag.diagnosticFailure('hiz-pipeline-fallback', error);
    dropGpuHiz(rt);
    rasterPipelines = await createWebgpuVisibilityRasterPipelines(
      gpuDevice,
      visModule,
      vis.visBindGroupLayout!,
      false,
    );
  }
  ({
    visPipelineBack: vis.visPipelineBack,
    visPipelineBackCw: vis.visPipelineBackCw,
    visPipelineNone: vis.visPipelineNone,
    visPipelineFront: vis.visPipelineFront,
    visPipelineFrontCw: vis.visPipelineFrontCw,
    visHizRestBack: vis.visHizRestBack,
    visHizRestNone: vis.visHizRestNone,
    visHizRestFront: vis.visHizRestFront,
  } = rasterPipelines);
  vis.visLayerPipelines.length = 0;
  if (vis.drawLayerSlots > 1)
    try {
      vis.visLayerPipelines = await createWebgpuCoplanarLayerPipelines(
        gpuDevice,
        visModule,
        vis.visBindGroupLayout!,
        !!vis.gpuHiz && !!vis.visHizRestBack,
        vis.drawLayerSlots,
      );
      diag.engineDiagnostic('coplanar-layers-ready', 'Couches coplanaires prêtes', {
        layers: vis.drawLayerSlots - 1,
        pipelines: vis.visLayerPipelines.length,
        biasUnitsPerLayer: -depthLayerBias(1),
      });
    } catch (error) {
      diag.diagnosticFailure('coplanar-layer-pipelines-failed', error);
      vis.visLayerPipelines = [];
      vis.drawLayerSlots = 1;
    }
  ({ shadeBindGroupLayout: vis.shadeBindGroupLayout, shadePipeline: vis.shadePipeline } =
    await createWebgpuShadePipeline(gpuDevice, shadeModule));
  if (!vis.pageTable)
    vis.pageTable = gpuDevice.createBuffer({
      size: PAGE_INFO_STRIDE,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
  if (
    vis.visView &&
    gpu.cache &&
    vis.concatPos &&
    vis.concatUv &&
    vis.concatNrm &&
    vis.colorAtlas &&
    vis.dataAtlas &&
    vis.mapsSampler &&
    vis.slots &&
    vis.shadeUniform &&
    vis.shadeBindGroupLayout
  ) {
    vis.shadeBindGroup = gpuDevice.createBindGroup({
      layout: vis.shadeBindGroupLayout,
      entries: shadeBindEntries({
        visView: vis.visView,
        cache: gpu.cache.buffer,
        position: vis.concatPos,
        uv: vis.concatUv,
        normal: vis.concatNrm,
        pageTable: vis.pageTable,
        colorAtlas: vis.colorAtlas,
        sampler: vis.mapsSampler,
        uniform: vis.shadeUniform,
        dataAtlas: vis.dataAtlas,
        slots: vis.slots,
      }),
    });
  }
  vis.visEnabled =
    !!vis.visTexture && !!vis.shadeBindGroup && !!vis.shadePipeline && !!vis.visPipelineBack;
  if (!vis.visEnabled) return dropVis(rt);
  diag.engineDiagnostic('material-surfaces-ready', 'Surfaces et éclairage séparés', {
    surfaceVersion: 1,
    formats: SURFACE_FORMATS,
    bytesPerPixel: 28,
    lighting: 'HDR',
    globalIllumination: false,
    motionVectors: false,
  });
  capabilities.materials =
    'Source glTF via GGX direct specular and hemisphere diffuse lighting with visibility buffer; double-sided when the material is';
  capabilities.unsupported = capabilities.unsupported.filter(
    (item) => !VIS_FEATURES.includes(item),
  );
  vis.gpuDraw = await createGpuDraw(gpuDevice, drawSlots, vis.drawLayerSlots);
  if (vis.gpuDraw) grantCapability(capabilities, 'indirect draw');
  // La partition se monte en dernier : elle écrit les tampons de la compaction et relit les verdicts
  // de la pyramide. Sans elle, les bits de reste restent à zéro et tous les slots sont compactés —
  // l'image se dessine en une passe, sans occultation, et rien ne tombe en silence.
  if (vis.gpuDraw && vis.gpuHiz) {
    vis.gpuPartition = await createGpuPartition(gpuDevice, drawSlots, {
      items: vis.gpuDraw.itemsBuffer,
      flags: vis.gpuHiz.flags,
      restBits: vis.gpuDraw.restBitsBuffer,
      slotUsed: vis.gpuDraw.slotUsedBuffer,
    });
    if (vis.gpuPartition) vis.gpuHiz.attach(vis.gpuPartition.tested, vis.gpuPartition.state);
    else
      diag.diagnosticFailure('partition-pipeline-unavailable', new Error('PARTITION_UNAVAILABLE'));
  }
  // Le test d'occultation des transparents vient en dernier : il emprunte la pyramide, l'uniforme de
  // la partition et le tampon de verdicts de la compaction, et n'existe pas sans les trois.
  await prepareTransparentOcclusion(rt, gpuDevice);
}
