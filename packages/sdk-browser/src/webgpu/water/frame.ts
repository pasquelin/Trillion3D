import { createWebgpuBindIdentity } from '../core/bindIdentity.ts';
import { drawBlendRuns } from '../blend/draw.ts';
import { feedbackAttachment, surfaceColorAttachments } from '../pages/prepare/attachments.ts';
import type { BlendLighting } from '../core/bindEntries.ts';
import type { BlendPipelines } from '../blend/stagePipelines.ts';
import type { SurfaceBuffer } from '../../scene/surfaceBuffer.ts';
import type { WebgpuGpuState } from '../pages/state/gpu.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import { WATER_BINDINGS } from './compositeWgsl.ts';
import {
  createWaterCompositeLayout,
  createWaterCompositePipeline,
  createWaterRoutedPipeline,
} from './pipelines.ts';
import { routedFilter } from '../blend/displayFilter.ts';

/** Labels of the two measured passes; their GPU durations are read under these names. */
export const WATER_SURFACE_PASS = 'Trillion3D water surfaces';
export const WATER_COMPOSITE_PASS = 'Trillion3D water composite';

/**
 * The frame side of the water pass: the composite program, and everything an image reuses as long
 * as what it names does not change — the bind group, the two copies that freeze the backdrop, the
 * surface pass and the composite pass. The targets change on a resize, the lighting resources
 * when the shadow atlas or the probe grid arrive: `bind` writes their identities and rebuilds only
 * when one moved, so a still frame builds and allocates nothing.
 */
export async function createWaterFrame(device: GPUDevice) {
  const layout = createWaterCompositeLayout(device);
  const pipeline = await createWaterCompositePipeline(device, layout);
  const identity = createWebgpuBindIdentity();
  let group: GPUBindGroup | undefined, surfaces: SurfaceBuffer | undefined;
  let routed: GPURenderPipeline | undefined;
  const from = { texture: undefined as unknown as GPUTexture },
    color = { texture: undefined as unknown as GPUTexture },
    depth = { texture: undefined as unknown as GPUTexture },
    waterDepth = { texture: undefined as unknown as GPUTexture },
    extent = { width: 1, height: 1 };
  const surfaceDepth: GPURenderPassDepthStencilAttachment = {
    view: undefined as unknown as GPUTextureView,
    depthLoadOp: 'load',
    depthStoreOp: 'store',
  };
  // The three material surfaces, the water word — cleared: zero says "no water here" to the
  // composite —, then the feedback target, whose load `feedbackAttachment` decides per image.
  const word: GPURenderPassColorAttachment = {
    view: undefined as unknown as GPUTextureView,
    loadOp: 'clear',
    storeOp: 'store',
    clearValue: [0, 0, 0, 0],
  };
  const attachments: GPURenderPassColorAttachment[] = [];
  const surfacePass: GPURenderPassDescriptor = {
    label: WATER_SURFACE_PASS,
    colorAttachments: attachments,
    depthStencilAttachment: surfaceDepth,
  };
  const target: GPURenderPassColorAttachment = {
    view: undefined as unknown as GPUTextureView,
    loadOp: 'load',
    storeOp: 'store',
  };
  const compositePass: GPURenderPassDescriptor = {
    label: WATER_COMPOSITE_PASS,
    colorAttachments: [target],
  };
  const plain = compositePass.colorAttachments;
  return {
    /** Names the frame's targets and resources; false while one of them does not exist. */
    bind(gpu: WebgpuGpuState, uniform: GPUBuffer, lighting: BlendLighting) {
      const { backdrop, deferred, volumeBuffer } = gpu;
      if (
        !gpu.surfaces ||
        !gpu.hdrTexture ||
        !gpu.hdrView ||
        !gpu.depthTexture ||
        !gpu.depthView ||
        !gpu.colorView ||
        !backdrop?.active ||
        !deferred ||
        !volumeBuffer
      )
        return false;
      const { next } = identity;
      next[0] = gpu.surfaces;
      next[1] = gpu.hdrView;
      next[2] = gpu.depthView;
      next[3] = backdrop;
      next[4] = volumeBuffer;
      next[5] = uniform;
      next[6] = deferred.uniform;
      next[7] = lighting.directLights;
      next[8] = lighting.tileLights;
      next[9] = lighting.shadowData;
      next[10] = lighting.shadowAtlas;
      next[11] = lighting.shadowSampler;
      next[12] = lighting.bounceGrid;
      next[13] = lighting.probes;
      next[14] = lighting.proxy;
      // The translucent depth is made and dropped with it.
      next[15] = lighting.shadowTransmittance;
      next[16] = lighting.surfaceCache;
      next[17] = gpu.colorView;
      if (!identity.moved()) return true;
      surfaces = gpu.surfaces;
      from.texture = gpu.hdrTexture;
      color.texture = backdrop.color;
      depth.texture = gpu.depthTexture;
      waterDepth.texture = backdrop.waterDepth;
      [extent.width, extent.height] = gpu.targetSize;
      surfaceDepth.view = backdrop.waterDepthView;
      target.view = gpu.hdrView;
      word.view = gpu.colorView;
      attachments.length = 0;
      attachments.push(...surfaceColorAttachments(surfaces).slice(0, 3), word);
      const b = WATER_BINDINGS;
      group = device.createBindGroup({
        layout,
        entries: [
          ...surfaces
            .views()
            .slice(0, 3)
            .map((resource, binding) => ({ binding, resource })),
          { binding: b.word, resource: gpu.colorView },
          { binding: b.depth, resource: backdrop.waterDepthView },
          { binding: b.view, resource: { buffer: deferred.uniform } },
          { binding: b.directLights, resource: { buffer: lighting.directLights } },
          { binding: b.tileLights, resource: { buffer: lighting.tileLights } },
          { binding: b.shadowData, resource: { buffer: lighting.shadowData } },
          { binding: b.shadowAtlas, resource: lighting.shadowAtlas },
          { binding: b.shadowSampler, resource: lighting.shadowSampler },
          { binding: b.shadowTransmittance, resource: lighting.shadowTransmittance },
          { binding: b.shadowTranslucentDepth, resource: lighting.shadowTranslucentDepth },
          { binding: b.bounceGrid, resource: { buffer: lighting.bounceGrid } },
          { binding: b.probes, resource: { buffer: lighting.probes } },
          { binding: b.proxy, resource: { buffer: lighting.proxy } },
          { binding: b.surface, resource: { buffer: lighting.surfaceCache } },
          { binding: b.backdrop, resource: backdrop.colorView },
          { binding: b.backdropDepth, resource: gpu.depthView },
          { binding: b.uniform, resource: { buffer: uniform } },
          { binding: b.volumes, resource: { buffer: volumeBuffer } },
        ],
      });
      return true;
    },
    /**
     * Encodes the water pass on the image the blends left. The backdrop is frozen — the lit image
     * copied, the opaque depth copied into the depth the surface stage tests —, the transmissive
     * surfaces draw into the opaque resolve's material surfaces, free since that resolve consumed
     * them, and the water word into the display colour the composition writes later — the surface
     * flags stay the opaque resolve's, read by temporal antialiasing and the composition after this
     * pass —, with hardware depth written
     * so the nearest surface of a pixel is the one kept; then one
     * fullscreen triangle lights and composes every water pixel into the HDR target, which keeps
     * what it held wherever no water is (the display layers where their mask is set). Returns the
     * surface draws encoded.
     */
    encode(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder, pipelines: BlendPipelines) {
      if (!group || !surfaces) throw new Error('WATER_NOT_BOUND');
      encoder.copyTextureToTexture(from, color, extent);
      encoder.copyTextureToTexture(depth, waterDepth, extent);
      if (rt.feedbackAB?.target !== false) attachments[4] = feedbackAttachment(rt);
      else attachments.length = 4;
      const pass = encoder.beginRenderPass(surfacePass);
      pass.setViewport(0, 0, extent.width, extent.height, 0, 1);
      const encoded = drawBlendRuns(rt, device, pass, 1, pipelines);
      pass.end();
      const filter = routedFilter(rt.gpu.displayFilter);
      compositePass.colorAttachments = filter ? [target, ...filter.attachments()] : plain;
      const composite = encoder.beginRenderPass(compositePass);
      composite.setPipeline(
        filter ? (routed ??= createWaterRoutedPipeline(device, layout)) : pipeline,
      );
      composite.setBindGroup(0, group);
      if (rt.gpu.reflection) composite.setBindGroup(1, rt.gpu.reflection.group);
      if (filter) composite.setBindGroup(2, filter.maskGroup);
      composite.draw(3);
      composite.end();
      return encoded;
    },
    dispose() {
      group = undefined;
      surfaces = undefined;
    },
  };
}

export type WaterFrame = Awaited<ReturnType<typeof createWaterFrame>>;
