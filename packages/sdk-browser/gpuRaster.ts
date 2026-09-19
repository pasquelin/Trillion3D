import {
  DISPATCH_SPAN,
  DISPATCH_WORDS,
  HEADER_CLEAR_BYTES,
  LIST_HEADER,
  MODE_DEPTH_OCCLUDER,
  MODE_DEPTH_REST,
  MODE_ID,
  RASTER_CLASSES,
  rasterEntry,
} from './gpuRasterContract.ts';
import { RESOLVE, rasterSource } from './gpuRasterShader.ts';
import { SMALL_BINDINGS, atlasLayoutEntries, readOnly } from './webgpuBindLayout.ts';
import { smallBindEntries } from './webgpuBindEntries.ts';
import { createRasterResolves } from './gpuRasterResolve.ts';
import type { GpuRasterInput } from './gpuRasterTypes.ts';

/**
 * Compute raster of the opaque and masked cut.
 *
 * `capacity` is the number of triangles a list can hold: every triangle of every drawable row.
 * Both lists therefore each hold the whole, and no frame loses one.
 */
export function createGpuRaster(
  device: GPUDevice,
  width: number,
  height: number,
  capacity: number,
) {
  // One storage buffer for the image and for the lists: the compute stage is allowed only eight
  // buffers on the poorest device WebGPU guarantees, and the raster uses them all.
  const targetBytes = Math.max(8, width * height * 8),
    listOffset = targetBytes;
  const work = device.createBuffer({
    label: 'WG raster target and lists',
    size: listOffset + Math.max(4, (LIST_HEADER + 2 * capacity) * 4),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  });
  // Dispatch words are copied out of the lists instead of being written by a binding, so no
  // pass holds the buffer it launches from.
  const indirect = device.createBuffer({
    label: 'WG raster dispatch',
    size: DISPATCH_WORDS * 4,
    usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
  });
  const b = SMALL_BINDINGS;
  const compute = GPUShaderStage.COMPUTE;
  const computeLayout = device.createBindGroupLayout({
    entries: [
      { binding: b.indices, visibility: compute, buffer: readOnly },
      { binding: b.positions, visibility: compute, buffer: readOnly },
      { binding: b.pages, visibility: compute, buffer: readOnly },
      { binding: b.hizFlags, visibility: compute, buffer: readOnly },
      { binding: b.uniform, visibility: compute, buffer: { type: 'uniform' } },
      { binding: b.uvs, visibility: compute, buffer: readOnly },
      ...atlasLayoutEntries(b.color, compute),
      { binding: b.sampler, visibility: compute, sampler: {} },
      { binding: b.work, visibility: compute, buffer: { type: 'storage' } },
      { binding: b.selectionMask, visibility: compute, buffer: readOnly },
    ],
  });
  const computeModule = device.createShaderModule({ code: rasterSource(capacity, listOffset / 4) });
  const computePipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [computeLayout] });
  const pipelineFor = (entryPoint: string) =>
    device.createComputePipeline({
      layout: computePipelineLayout,
      compute: { module: computeModule, entryPoint },
    });
  const clear = pipelineFor('clear'),
    bin = pipelineFor('bin'),
    plan = pipelineFor('plan');
  /** One pipeline per class and per mode: the mode does not travel by a uniform, it IS the
   *  entry point, so no dispatch rereads a word to know what it does. */
  const raster = RASTER_CLASSES.map((klass) =>
    [MODE_DEPTH_OCCLUDER, MODE_DEPTH_REST, MODE_ID].map((mode) =>
      pipelineFor(rasterEntry(klass, mode)),
    ),
  );
  const resolves = createRasterResolves(device, RESOLVE, work, targetBytes);
  let group: GPUBindGroup | undefined;
  /** The four indirect dispatches of a mode, in a single compute pass. */
  const encodeMode = (encoder: GPUCommandEncoder, mode: number, label: string) => {
    const pass = encoder.beginComputePass({ label });
    pass.setBindGroup(0, group!);
    for (let klass = 0; klass < RASTER_CLASSES.length; klass++) {
      pass.setPipeline(raster[klass]![mode]!);
      pass.dispatchWorkgroupsIndirect(indirect, klass * 12);
    }
    pass.end();
  };
  return {
    width,
    height,
    capacity,
    /**
     * Occluder half: binning the cut, occluder depth, and its merge into pyramid level zero and
     * the depth buffer the hardware raster just wrote. Returns the number of compute dispatches
     * encoded.
     */
    encodeOccluders(encoder: GPUCommandEncoder, input: GpuRasterInput) {
      // Every resource outlives the frame: the caller keeps the groups and names the one this
      // combination of verdict source and selection uses.
      group = (input.groups[input.groupKey] ??= device.createBindGroup({
        layout: computeLayout,
        entries: smallBindEntries({
          indices: input.indices,
          positions: input.positions,
          pages: input.pages,
          hizFlags: input.hizFlags,
          uniform: input.uniform,
          uniformSize: 96,
          uvs: input.uvs,
          textures: input.textures,
          sampler: input.sampler,
          work,
          selectionMask: input.selection?.maskBuffer ?? input.hizFlags,
        }),
      })) as GPUBindGroup;
      encoder.clearBuffer(work, listOffset, HEADER_CLEAR_BYTES);
      const rows = Math.max(1, input.pageRows),
        spanY = Math.min(rows, DISPATCH_SPAN),
        spanZ = Math.ceil(rows / DISPATCH_SPAN);
      const binning = encoder.beginComputePass({ label: 'WG raster binning' });
      binning.setBindGroup(0, group);
      binning.setPipeline(clear);
      binning.dispatchWorkgroups(Math.ceil((width * height) / 64));
      binning.setPipeline(bin);
      binning.dispatchWorkgroups(Math.max(1, Math.ceil(input.maxTriangles / 64)), spanY, spanZ);
      binning.setPipeline(plan);
      binning.dispatchWorkgroups(1);
      binning.end();
      encoder.copyBufferToBuffer(work, listOffset + 24, indirect, 0, DISPATCH_WORDS * 4);
      // One pass per raster dispatch: two consecutive dispatches already see each other's
      // writes, so every class has written its depth before any chooses an identifier. An
      // identifier chosen before a class has written its depth would name a losing triangle.
      encodeMode(encoder, MODE_DEPTH_OCCLUDER, 'WG raster occluder depth');
      if (input.tested) resolves.encodeHiz(encoder, input, width, height);
      return 3 + RASTER_CLASSES.length;
    },
    /** Surviving tested half, after the pyramid verdict. */
    encodeRest(encoder: GPUCommandEncoder) {
      encodeMode(encoder, MODE_DEPTH_REST, 'WG raster tested depth');
      return RASTER_CLASSES.length;
    },
    /** Identifier resolve over everything that was drawn, and the frame closed. */
    encodeIds(encoder: GPUCommandEncoder, input: GpuRasterInput) {
      encodeMode(encoder, MODE_ID, 'WG raster identifiers');
      resolves.encodeFinal(encoder, input, width, height);
      return RASTER_CLASSES.length;
    },
    dispose() {
      work.destroy();
      indirect.destroy();
    },
  };
}
export type GpuRaster = ReturnType<typeof createGpuRaster>;
