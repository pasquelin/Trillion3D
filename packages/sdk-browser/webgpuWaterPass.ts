import { blendPassReady, countBlendDraws, drawBlendRuns } from './webgpuBlendDraw.ts';
import { shadeColorAttachments } from './webgpuPagesAttachments.ts';
import { copyBackdrop } from './webgpuTransmission.ts';
import { blendLightResources } from './webgpuBlendLighting.ts';
import { createWaterComposite, type WaterComposite } from './webgpuWaterComposite.ts';
import { createWaterSurfacePipelines, type WaterSurfacePipelines } from './webgpuWaterPipelines.ts';
import { WATER_MAX_ITEMS } from './webgpuWaterSurfaceWgsl.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** Label of the measured surface stage; its GPU duration is read under this name. */
export const WATER_SURFACE_PASS = 'WG water surfaces';

/** The water pass of a scene: its surface pipelines and its composite, built at prepare. */
export interface WaterPass {
  surfaces: WaterSurfacePipelines;
  composite: WaterComposite;
}

/** The item rank travels in sixteen bits of the surface: a scene with more transparent items than
 *  that has no water pass — its transmission slice draws as a blend — and the refusal is named
 *  (`water-pass-refused`) rather than composed wrong. `undefined` when the scene fits. */
export function waterPassRefusal(items: number) {
  return items > WATER_MAX_ITEMS
    ? new Error(`WATER_ITEMS_LIMIT: ${items} transparent items, ${WATER_MAX_ITEMS} at most`)
    : undefined;
}

/**
 * Builds the pass for a scene that carries a transmissive item. `module` and `layout` are the
 * blend pass's: the surface stage is one more fragment entry of the same module, on the same bind
 * groups.
 */
export async function createWaterPass(
  device: GPUDevice,
  module: GPUShaderModule,
  layout: GPUBindGroupLayout,
): Promise<WaterPass> {
  const [surfaces, composite] = await Promise.all([
    createWaterSurfacePipelines(device, module, layout),
    createWaterComposite(device),
  ]);
  return { surfaces, composite };
}

/**
 * Encodes the water pass, after the blends and on the image they left: the backdrop is frozen,
 * the transmissive surfaces are drawn into their surface buffer — hardware depth against the
 * opaque, nearest surface kept —, then one fullscreen triangle lights and composes every water
 * pixel into the HDR target. Returns whether the pass was encoded; without a transmissive
 * surface, without the pipelines, or under a diagnostic view, nothing of it exists in the frame.
 */
export function encodeWaterPass(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  inverseViewProjection: ArrayLike<number>,
) {
  const { gpu, run, blendState } = rt,
    water = blendState.water,
    backdrop = gpu.backdrop;
  // A diagnostic view colours a surface instead of lighting it: the slice draws as a blend, whose
  // fragment carries that colouring, and the composite has none.
  if (
    run.diagnostic !== 'beauty' ||
    !water ||
    !backdrop ||
    !gpu.hdrView ||
    !gpu.volumeBuffer ||
    !blendState.viewBuffer ||
    !blendPassReady(rt, 1) ||
    !copyBackdrop(rt, encoder)
  )
    return false;
  const [width, height] = gpu.targetSize;
  const pass = encoder.beginRenderPass({
    label: WATER_SURFACE_PASS,
    // The surfaces are cleared: zero says "no water here" to the composite.
    colorAttachments: shadeColorAttachments(rt, backdrop.surfaces),
    depthStencilAttachment: {
      view: backdrop.waterDepthView,
      depthLoadOp: 'load',
      depthStoreOp: 'store',
    },
  });
  pass.setViewport(0, 0, width, height, 0, 1);
  const encoded = drawBlendRuns(rt, device, pass, 1, water.surfaces);
  pass.end();
  countBlendDraws(rt, encoded, true);
  // The surface stage just resolved the lighting resources of the frame: the composite binds the
  // same, and rebuilds its group only when one of them, or a target, has changed.
  water.composite.update(inverseViewProjection, width, height);
  water.composite.bind(
    { backdrop, uniform: blendState.viewBuffer, volumes: gpu.volumeBuffer },
    blendLightResources(rt),
  );
  water.composite.compose(encoder, gpu.hdrView);
  run.gpuDrawCalls++;
  return true;
}
