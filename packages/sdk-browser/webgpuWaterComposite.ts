import { WATER_BINDINGS, WATER_VIEW_SIZE } from './webgpuWaterCompositeWgsl.ts';
import {
  createWaterCompositeLayout,
  createWaterCompositePipeline,
} from './webgpuWaterPipelines.ts';
import type { BlendLighting } from './webgpuBindEntries.ts';
import type { TransmissionBackdrop } from './webgpuPagesStateGpu.ts';

/** Label of the measured pass; its GPU duration is read under this name. */
export const WATER_COMPOSITE_PASS = 'WG water composite';

/** What the composite binds beyond the lighting contract: the frame's targets and buffers. */
export interface WaterCompositeResources {
  backdrop: TransmissionBackdrop;
  uniform: GPUBuffer;
  volumes: GPUBuffer;
}

/**
 * The composite program: its layout, its pipeline, its view uniform, and the one bind group it
 * keeps as long as what it names does not change — the targets change on a resize, the shadow
 * atlas and the probe grid arrive after the first frames. `bind` compares every resource and
 * rebuilds only then: a still frame builds nothing.
 */
export async function createWaterComposite(device: GPUDevice) {
  const layout = createWaterCompositeLayout(device);
  const pipeline = await createWaterCompositePipeline(device, layout);
  const view = device.createBuffer({
    label: 'WG water view',
    size: WATER_VIEW_SIZE,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const packed = new Float32Array(WATER_VIEW_SIZE / 4);
  let bound: (object | undefined)[] = [],
    group: GPUBindGroup | undefined;
  return {
    /** Inverse view-projection and viewport of the image: what reconstructs a world position from
     *  the water depth. Written once per image that composes water. */
    update(inverseViewProjection: ArrayLike<number>, width: number, height: number) {
      packed.set(inverseViewProjection as ArrayLike<number> & number[], 0);
      packed[16] = width;
      packed[17] = height;
      device.queue.writeBuffer(view, 0, packed);
    },
    bind(resources: WaterCompositeResources, lighting: BlendLighting) {
      const b = WATER_BINDINGS,
        { backdrop, uniform, volumes } = resources,
        surfaces = backdrop.surfaces.views();
      const named = [
        ...surfaces,
        backdrop.waterDepthView,
        backdrop.colorView,
        backdrop.depthView,
        uniform,
        volumes,
        lighting.directLights,
        lighting.tileLights,
        lighting.shadowSlices,
        lighting.shadowAtlas,
        lighting.shadowSampler,
        lighting.bounceGrid,
        lighting.probes,
        lighting.proxy,
      ];
      if (group && named.length === bound.length && named.every((item, i) => item === bound[i]))
        return;
      bound = named;
      group = device.createBindGroup({
        layout,
        entries: [
          ...surfaces.map((resource, binding) => ({ binding, resource })),
          { binding: b.depth, resource: backdrop.waterDepthView },
          { binding: b.backdrop, resource: backdrop.colorView },
          { binding: b.backdropDepth, resource: backdrop.depthView },
          { binding: b.uniform, resource: { buffer: uniform } },
          { binding: b.view, resource: { buffer: view } },
          { binding: b.volumes, resource: { buffer: volumes } },
          { binding: b.directLights, resource: { buffer: lighting.directLights } },
          { binding: b.tileLights, resource: { buffer: lighting.tileLights } },
          { binding: b.shadowSlices, resource: { buffer: lighting.shadowSlices } },
          { binding: b.shadowAtlas, resource: lighting.shadowAtlas },
          { binding: b.shadowSampler, resource: lighting.shadowSampler },
          { binding: b.bounceGrid, resource: { buffer: lighting.bounceGrid } },
          { binding: b.probes, resource: { buffer: lighting.probes } },
          { binding: b.proxy, resource: { buffer: lighting.proxy } },
        ],
      });
    },
    /** One fullscreen triangle over the HDR target, which keeps what it held wherever no water is. */
    compose(encoder: GPUCommandEncoder, target: GPUTextureView) {
      if (!group) throw new Error('WATER_NOT_BOUND');
      const pass = encoder.beginRenderPass({
        label: WATER_COMPOSITE_PASS,
        colorAttachments: [{ view: target, loadOp: 'load', storeOp: 'store' }],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, group);
      pass.draw(3);
      pass.end();
    },
    dispose() {
      view.destroy();
      group = undefined;
      bound = [];
    },
  };
}

export type WaterComposite = Awaited<ReturnType<typeof createWaterComposite>>;
