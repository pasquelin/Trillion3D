import { createWebgpuBlendPipelines } from '../../blend/pipelines.ts';
import { ensureWebgpuShadeBindings } from '../../core/shadeBindings.ts';
import { createWebgpuVisibilityShaders } from '../../visibility/shaders.ts';
import {
  createWebgpuCoplanarLayerPipelines,
  createWebgpuShadePipelines,
  createWebgpuVisibilityRasterPipelines,
} from '../../visibility/pipelines.ts';
import { visUniformSlots } from '../../visibility/uniforms.ts';
import { MAX_DEPTH_LAYER, depthLayerUnits } from '../../../../../sdk-core/src/index.ts';
import { createGpuHiz } from '../../../gpu/hiz/hiz.ts';
import { createGpuDraw } from '../../../gpu/draw/draw.ts';
import { createGpuPartition } from '../../../gpu/partition/factory.ts';
import { createGpuRestCompact } from '../../../gpu/raster/restCompact.ts';
import { prepareTransparentOcclusion } from '../../transparent/occlusionHost.ts';
import { PAGE_INFO_STRIDE } from '../../../visibility/buffer.ts';
import { sceneMaterialClasses } from '../../row/pageRowMaterial.ts';
import { SURFACE_BYTES_PER_PIXEL, SURFACE_FORMATS } from '../../../scene/surfaceBuffer.ts';
import { dropGpuHiz, dropVis, grantCapability } from '../io/drops.ts';
import { VIS_FEATURES, type WebgpuPagesRuntime } from '../runtime.ts';

/** Builds the forward material pipelines, the visibility raster and shade pipelines, the Hi-Z
 *  pyramid and the indirect draw; leaves `visEnabled` telling whether the image can use them. */
export async function prepareWebgpuVisibility(rt: WebgpuPagesRuntime, gpuDevice: GPUDevice) {
  const { vis, capabilities, diag, blendState } = rt,
    { drawSlots } = rt.layout,
    [width, height] = rt.setup.viewport;
  try {
    const built = await createWebgpuBlendPipelines(
      gpuDevice,
      blendState.blendGpu,
      rt.context.diagnosticGpuVariant,
    );
    ({
      blendBindGroupLayout: vis.blendBindGroupLayout,
      blendPipelines: vis.blendPipelines,
      water: blendState.water,
    } = built);
    // No water pass — the device refused it: the blends stay, the transmission slice draws as one
    // of them, and the host reads why.
    if (built.waterRefused) diag.diagnosticFailure('water-pass-refused', built.waterRefused);
  } catch (error) {
    diag.diagnosticFailure('forward-material-pipeline-failed', error);
    vis.blendBindGroupLayout = undefined;
    vis.blendPipelines = undefined;
    blendState.water = undefined;
  }
  // Coplanar-stack depth sets the draw-slot count, therefore the visibility uniform size and that of
  // indirect compaction: it is read before creating them.
  let maxDepthLayer = 0;
  for (const rec of rt.setup.allPages)
    if (rec.depthLayer > maxDepthLayer) maxDepthLayer = rec.depthLayer;
  vis.drawLayerSlots = 1 + Math.min(maxDepthLayer, MAX_DEPTH_LAYER);
  const variant = rt.context?.diagnosticGpuVariant;
  const shaders = await createWebgpuVisibilityShaders(
    gpuDevice,
    drawSlots,
    visUniformSlots(vis),
    variant,
  );
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
      variant,
    );
  } catch (error) {
    diag.diagnosticFailure('hiz-pipeline-fallback', error);
    dropGpuHiz(rt);
    rasterPipelines = await createWebgpuVisibilityRasterPipelines(
      gpuDevice,
      visModule,
      vis.visBindGroupLayout!,
      false,
      variant,
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
        variant,
      );
      diag.engineDiagnostic('coplanar-layers-ready', 'Coplanar layers ready', {
        layers: vis.drawLayerSlots - 1,
        pipelines: vis.visLayerPipelines.length,
        biasUnitsPerLayer: depthLayerUnits(1),
      });
    } catch (error) {
      diag.diagnosticFailure('coplanar-layer-pipelines-failed', error);
      vis.visLayerPipelines = [];
      vis.drawLayerSlots = 1;
    }
  // The resolve classes of the scene are known here, from the same fields its rows will carry:
  // one pipeline each, and the material-depth export they all test against.
  const classes = sceneMaterialClasses(rt.setup.allPages, vis.geometryBlocks, vis);
  ({
    shadeBindGroupLayout: vis.shadeBindGroupLayout,
    materialDepthPipeline: vis.materialDepthPipeline,
    shadePipelineFor: vis.shadePipelineFor,
    shadePipelines: vis.shadePipelines,
  } = await createWebgpuShadePipelines(gpuDevice, shadeModule, classes, variant));
  diag.engineDiagnostic('material-classes-ready', 'Resolve classes and their pipelines', {
    classes: classes.length,
    keys: classes,
  });
  if (!vis.pageTable)
    vis.pageTable = gpuDevice.createBuffer({
      size: PAGE_INFO_STRIDE,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
  ensureWebgpuShadeBindings(rt, gpuDevice);
  vis.visEnabled =
    !!vis.visTexture &&
    !!vis.shadeBindGroup &&
    !!vis.materialDepthPipeline &&
    !!vis.visPipelineBack;
  if (!vis.visEnabled) return dropVis(rt);
  diag.engineDiagnostic('material-surfaces-ready', 'Surfaces and lighting split', {
    surfaceVersion: 1,
    formats: SURFACE_FORMATS,
    bytesPerPixel: SURFACE_BYTES_PER_PIXEL,
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
  // The partition mounts last: it writes compaction buffers and rereads pyramid verdicts. Without
  // it, rest bits stay at zero and every slot is compacted — the image draws in one pass, without
  // occlusion, and nothing falls in silence.
  if (vis.gpuDraw && vis.gpuHiz) {
    vis.gpuPartition = await createGpuPartition(gpuDevice, drawSlots, {
      items: vis.gpuDraw.itemsBuffer,
      flags: vis.gpuHiz.flags,
      restBits: vis.gpuDraw.restBitsBuffer,
      slotUsed: vis.gpuDraw.slotUsedBuffer,
      pyramid: () => vis.gpuHiz?.pyramidBuffer(),
    });
    // Compaction of the tested half reads the pyramid verdict and rewrites the instance list draw
    // compaction just posted: it exists only with both.
    vis.gpuRestCompact = await createGpuRestCompact(gpuDevice, {
      instances: vis.gpuDraw.instanceBuffer,
      indirect: vis.gpuDraw.indirectBuffer,
      slotOffsets: vis.gpuDraw.slotOffsetsBuffer,
      flags: vis.gpuHiz.flags,
    });
    if (vis.gpuPartition) vis.gpuHiz.attach(vis.gpuPartition.tested, vis.gpuPartition.state);
    else
      diag.diagnosticFailure('partition-pipeline-unavailable', new Error('PARTITION_UNAVAILABLE'));
  }
  // The transparent occlusion test comes last: it borrows the pyramid, the partition uniform and
  // the compaction verdict buffer, and does not exist without the three.
  await prepareTransparentOcclusion(rt, gpuDevice);
}
