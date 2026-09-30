import { createCheckedShaderModule } from '../core/shaderModule.ts';
import { MAX_SHADOW_REGIONS as R } from './recordPack.ts';
import { SHADOW_FACE_STRIDE } from './batchBudget.ts';
import { shadowBatchWrites } from './batchWrites.ts';
import { preparedPipeline } from '../../lighting/deferred/fullscreen.ts';
import { staticLayerEntries } from './staticLayer.ts';
import { SHADOW_TRANSLUCENT_DEPTH_FORMAT, SHADOW_TRANSMITTANCE_FORMAT } from './transmittance.ts';
import { PAGE_QUAD_SHADER } from './pageWgsl.ts';

/** Bytes of the faces' entries, before the batch's pass order in the same buffer (`atlas.ts`). */
const ORDER_OFFSET = R * SHADOW_FACE_STRIDE;

export type ShadowPageQuads = Awaited<ReturnType<typeof createShadowPageQuads>>;

/**
 * THE PAGE QUADS of a shadow render pass (#815): every region of the pass that starts cleared to
 * far is one instance of a single draw, every region restored from the static layer one instance of
 * another — two draws a pass, whatever its regions, over the whole atlas's viewport. The
 * transmittance layer's pass clears its pages in one more (`transmittance.ts`): its viewport is half
 * the pool's, and so is the square in texels. They read the face buffer `faces` (`atlas.ts`) as it
 * is.
 */
export async function createShadowPageQuads(device: GPUDevice, faces: GPUBuffer) {
  const module = await createCheckedShaderModule(device, PAGE_QUAD_SHADER, 'PAGE_QUAD');
  const dataLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
    ],
  });
  // The static layer's own layout: its groups bind here as they are.
  const layerLayout = device.createBindGroupLayout({ entries: staticLayerEntries() });
  const dataOnly = device.createPipelineLayout({ bindGroupLayouts: [dataLayout] });
  const descriptor = (
    label: string,
    layout: GPUPipelineLayout,
    fragment?: string,
    targets: GPUColorTargetState[] = [],
    depth: GPUTextureFormat = 'depth32float',
  ): GPURenderPipelineDescriptor => ({
    label: `Trillion3D shadow page ${label} v1`,
    layout,
    vertex: { module, entryPoint: 'page_quad_vs' },
    fragment: fragment ? { module, entryPoint: fragment, targets } : undefined,
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { format: depth, depthWriteEnabled: true, depthCompare: 'always' },
  });
  const pipeline = (label: string, layout: GPUPipelineLayout, fragment?: string) =>
    device.createRenderPipeline(descriptor(label, layout, fragment));
  const clear = pipeline('clear', dataOnly),
    restore = pipeline(
      'restore',
      device.createPipelineLayout({ bindGroupLayouts: [dataLayout, layerLayout] }),
      'restore_fs',
    );
  // Compiled at prepare for a scene whose blended surfaces cast, else at the first transmittance
  // pass: a scene that blends nothing never compiles it.
  const clearTransmittance = preparedPipeline(
    device,
    descriptor(
      'transmittance clear',
      dataOnly,
      'transmittance_clear_fs',
      [{ format: SHADOW_TRANSMITTANCE_FORMAT }],
      SHADOW_TRANSLUCENT_DEPTH_FORMAT,
    ),
  );
  const group = device.createBindGroup({
    layout: dataLayout,
    entries: [{ binding: 0, resource: { buffer: faces } }],
  });
  /** `count` regions from rank `first` of the order, one instance each, by `pipeline`. */
  const quads = (
    pass: GPURenderPassEncoder,
    pipeline: GPURenderPipeline,
    first: number,
    count: number,
  ) => {
    pass.setPipeline(pipeline);
    pass.draw(6, count, 0, first);
  };
  return {
    /** Writes a batch's pass `order` of its `regions` regions, after their faces. */
    begin(regions: number, order: Uint32Array<ArrayBuffer>) {
      shadowBatchWrites(device).write(faces, ORDER_OFFSET, order, 0, regions);
    },
    /**
     * Draws into `pass` the `clears` regions from rank `first` of the order, then the `restores`
     * after them, from the static layer's `layer` group. Returns the draws encoded.
     */
    encode(
      pass: GPURenderPassEncoder,
      first: number,
      clears: number,
      restores: number,
      layer?: GPUBindGroup,
    ) {
      pass.setBindGroup(0, group);
      if (clears) quads(pass, clear, first, clears);
      if (restores) {
        pass.setBindGroup(1, layer!);
        quads(pass, restore, first + clears, restores);
      }
      return +!!clears + +!!restores;
    },
    /** Compiles the transmittance clear off the frame, at prepare. */
    prepareTransmittance: clearTransmittance.prepare,
    /** Clears into the transmittance layer's `pass` the `count` regions from rank `first` of the
     *  order, in one draw. */
    clearTransmittance(pass: GPURenderPassEncoder, first: number, count: number) {
      pass.setBindGroup(0, group);
      quads(pass, clearTransmittance.get(), first, count);
    },
  };
}
