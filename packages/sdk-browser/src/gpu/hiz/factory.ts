import { encodeHizPyramid } from './pyramid.ts';
import {
  hizBuildPasses,
  hizBuildSlots,
  pyramidBytes,
  writeHizBuildUniforms,
  writeHizTestUniforms,
  type HizBuildPass,
} from './uniforms.ts';
import { cleanupFailedHiz, createHizPipelines } from './pipelines.ts';
import { TESTED_U32 } from '../partition/contract.ts';
import type { GpuHiz } from './types.ts';
const TEST_WORKGROUP = 64,
  UNIFORM_BYTES = 256,
  MAX_LEVELS = 16,
  // The build passes' uniform slots, then the test's.
  TEST_SLOT = hizBuildSlots(MAX_LEVELS);

/** Frame Hi-Z: reverse-Z, reduce to the minimum. Without compute, returns `undefined`. */
export async function createGpuHiz(
  device: GPUDevice,
  width: number,
  height: number,
  maxBounds: number,
): Promise<GpuHiz | undefined> {
  if (typeof device.createComputePipeline !== 'function' || width < 1 || height < 1)
    return undefined;
  const cap = Math.max(1, maxBounds);
  // `COPY_SRC` serves only the proof tools, which reread depth; no frame copies.
  const level0Usage =
    GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC;
  const testWords = new Uint32Array(UNIFORM_BYTES / 4);
  const buffers: GPUBuffer[] = [];
  let disposed = false,
    level0: GPUTexture | undefined,
    level0View: GPUTextureView | undefined,
    pyramid: GPUBuffer | undefined,
    bindGroup: GPUBindGroup | undefined;
  let sizes: Array<[number, number]> = [],
    offsets: number[] = [],
    passes: HizBuildPass[] = [];
  // The mip table depends only on the target size: built at allocation, reread as-is.
  let levelTable: Array<{ offset: number; width: number }> | undefined;
  try {
    const pipelines = await createHizPipelines(device, UNIFORM_BYTES);
    if (!pipelines) return undefined;
    const { layout, buildPipeline, testPipeline, pagesGroup } = pipelines;
    const uniforms = device.createBuffer({
      size: UNIFORM_BYTES * (TEST_SLOT + 1),
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    // Tested boxes and the frame state belong to the GPU partition, which does not exist yet:
    // until `attach`, the bind group points at this idle buffer, which nothing reads.
    const idle = device.createBuffer({
      label: 'Trillion3D HiZ idle bounds v1',
      size: TESTED_U32 * 4,
      usage: GPUBufferUsage.STORAGE,
    });
    let bounds = idle,
      state = idle;
    const flags = device.createBuffer({
      size: Math.max(4, cap * 4),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    buffers.push(uniforms, idle, flags);
    const bind = (nextPyramid: GPUBuffer, nextView: GPUTextureView) => {
      bindGroup = device.createBindGroup({
        layout,
        entries: [
          { binding: 0, resource: { buffer: nextPyramid } },
          { binding: 1, resource: nextView },
          { binding: 2, resource: { buffer: uniforms, size: UNIFORM_BYTES } },
          { binding: 3, resource: { buffer: bounds } },
          { binding: 4, resource: { buffer: flags } },
          { binding: 5, resource: { buffer: state } },
        ],
      });
    };
    const levelWords = new Uint32Array(TEST_SLOT * (UNIFORM_BYTES / 4));
    const alloc = (w: number, h: number) => {
      const packed = pyramidBytes(w, h);
      ({ sizes, offsets } = packed);
      passes = hizBuildPasses(sizes, MAX_LEVELS);
      levelTable = undefined;
      level0?.destroy();
      pyramid?.destroy();
      level0 = device.createTexture({
        size: { width: w, height: h },
        format: 'r32float',
        usage: level0Usage,
      });
      level0View = level0.createView();
      pyramid = device.createBuffer({
        size: packed.bytes,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      bind(pyramid, level0View);
      writeHizBuildUniforms(device, uniforms, levelWords, sizes, offsets, passes, UNIFORM_BYTES);
      return true;
    };
    if (!alloc(width, height) || !level0 || !level0View || !pyramid || !bindGroup) {
      for (const buffer of buffers) buffer.destroy();
      level0?.destroy();
      pyramid?.destroy();
      return undefined;
    }
    const gpu: GpuHiz = {
      width,
      height,
      level0,
      level0View,
      flags,
      // One compute pass builds the whole pyramid, four mips per dispatch (`buildHiz`).
      encodePyramid(encoder) {
        if (disposed || !bindGroup || !pyramid) return;
        encodeHizPyramid(
          encoder,
          'Trillion3D HiZ pyramid',
          bindGroup,
          buildPipeline,
          sizes,
          passes,
          UNIFORM_BYTES,
        );
      },
      /** Tested boxes and the frame state come from the GPU partition, mounted after us. */
      attach(nextBounds: GPUBuffer, nextState: GPUBuffer) {
        bounds = nextBounds;
        state = nextState;
        if (pyramid && level0View) bind(pyramid, level0View);
      },
      /** Pyramid mips, with their offset and width: what the partition reads to express a
       *  screen rectangle in texels of the mip that covers it exactly. */
      levels: () =>
        (levelTable ??= sizes.map((size, level) => ({ offset: offsets[level], width: size[0] }))),
      pyramidBuffer: () => (disposed ? undefined : pyramid),
      encodeTest(queueDevice, encoder, maxRows, flagRows, pages) {
        if (disposed || !bindGroup || bounds === idle) return 0;
        const rows = Math.min(maxRows, cap);
        if (flagRows > 0) encoder.clearBuffer(flags, 0, Math.min(cap, flagRows) * 4);
        const at = TEST_SLOT * UNIFORM_BYTES;
        writeHizTestUniforms(queueDevice, uniforms, testWords, at, gpu.width, gpu.height, rows);
        // The compacted box count lives in the state: the dispatch covers every drawable row
        // and threads past the count leave at the first test.
        const pass = encoder.beginComputePass({ label: 'Trillion3D HiZ test' });
        pass.setPipeline(testPipeline);
        pass.setBindGroup(0, bindGroup, [at]);
        pass.setBindGroup(1, pagesGroup(pages));
        pass.dispatchWorkgroups(Math.max(1, Math.ceil(rows / TEST_WORKGROUP)));
        pass.end();
        return rows;
      },
      resize(nextDevice, nextWidth, nextHeight) {
        if (disposed || !nextDevice || nextWidth < 1 || nextHeight < 1) return false;
        if (nextWidth === gpu.width && nextHeight === gpu.height && level0) return true;
        try {
          if (!alloc(nextWidth, nextHeight) || !level0 || !level0View) return false;
          gpu.width = nextWidth;
          gpu.height = nextHeight;
          gpu.level0 = level0;
          gpu.level0View = level0View;
          return true;
        } catch {
          return false;
        }
      },
      dispose() {
        disposed = true;
        for (const buffer of buffers) buffer.destroy();
        level0?.destroy();
        pyramid?.destroy();
        level0 = undefined;
        level0View = undefined;
        pyramid = undefined;
        bindGroup = undefined;
      },
    };
    return gpu;
  } catch {
    cleanupFailedHiz(buffers, level0, pyramid);
    return undefined;
  }
}
