import { encodeHizPyramid } from './gpuHizPyramid.ts';
import { pyramidBytes, writeUni } from './gpuHizUniforms.ts';
import { createHizBoundsPacker } from './gpuHizTest.ts';
import { cleanupFailedHiz, createHizPipelines } from './gpuHizPipelines.ts';
import type { GpuHiz } from './gpuHizTypes.ts';
const WORKGROUP = 8,
  TEST_WORKGROUP = 64,
  UNIFORM_BYTES = 256,
  MAX_LEVELS = 16;

/** This-frame Hi-Z from the visbuffer r32float depth (background 1, max reduction). Missing compute returns undefined. */
export async function createGpuHiz(
  device: GPUDevice,
  width: number,
  height: number,
  maxBounds: number,
): Promise<GpuHiz | undefined> {
  if (typeof device.createComputePipeline !== 'function' || width < 1 || height < 1)
    return undefined;
  const cap = Math.max(1, maxBounds);
  const uniData = new Float32Array(UNIFORM_BYTES / 4);
  const packBounds = createHizBoundsPacker();
  const buffers: GPUBuffer[] = [];
  let disposed = false,
    level0: GPUTexture | undefined,
    level0View: GPUTextureView | undefined,
    pyramid: GPUBuffer | undefined,
    bindGroup: GPUBindGroup | undefined;
  let sizes: Array<[number, number]> = [],
    offsets: number[] = [];
  try {
    const pipelines = await createHizPipelines(device, UNIFORM_BYTES);
    if (!pipelines) return undefined;
    const { layout, copyPipeline, reducePipeline, testPipeline } = pipelines;
    const uniformSlots = MAX_LEVELS + 2;
    const uniforms = device.createBuffer({
      size: UNIFORM_BYTES * uniformSlots,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const bounds = device.createBuffer({
      size: Math.max(32, cap * 32),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const flags = device.createBuffer({
      size: Math.max(4, cap * 4),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    buffers.push(uniforms, bounds, flags);
    const bind = (nextPyramid: GPUBuffer, nextView: GPUTextureView) => {
      bindGroup = device.createBindGroup({
        layout,
        entries: [
          { binding: 0, resource: { buffer: nextPyramid } },
          { binding: 1, resource: nextView },
          { binding: 2, resource: { buffer: uniforms, size: UNIFORM_BYTES } },
          { binding: 3, resource: { buffer: bounds } },
          { binding: 4, resource: { buffer: flags } },
        ],
      });
    };
    // Every level's source and destination are a function of the target size alone, so the whole
    // uniform array is written once per allocation and no image uploads a byte to build the pyramid.
    const levelWords = new Uint32Array((MAX_LEVELS + 1) * (UNIFORM_BYTES / 4));
    const alloc = (w: number, h: number) => {
      const packed = pyramidBytes(w, h);
      sizes = packed.sizes;
      offsets = [];
      let texels = 0;
      for (const [levelWidth, levelHeight] of sizes) {
        offsets.push(texels);
        texels += levelWidth * levelHeight;
      }
      level0?.destroy();
      pyramid?.destroy();
      level0 = device.createTexture({
        size: { width: w, height: h },
        format: 'r32float',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      level0View = level0.createView();
      pyramid = device.createBuffer({
        size: packed.bytes,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      bind(pyramid, level0View);
      levelWords.fill(0);
      levelWords[0] = w;
      levelWords[1] = h;
      levelWords[2] = 0;
      for (let i = 0; i < sizes.length - 1 && i + 1 < MAX_LEVELS; i++) {
        const [srcW, srcH] = sizes[i],
          [dstW, dstH] = sizes[i + 1],
          base = (i + 1) * (UNIFORM_BYTES / 4);
        levelWords[base] = offsets[i];
        levelWords[base + 1] = srcW;
        levelWords[base + 2] = srcH;
        levelWords[base + 3] = offsets[i + 1];
        levelWords[base + 4] = dstW;
        levelWords[base + 5] = dstH;
      }
      device.queue.writeBuffer(uniforms, 0, levelWords);
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
      // One compute pass builds the whole pyramid: consecutive dispatches inside a pass already see each
      // other's writes, so a pass per mip bought nothing but its own submission cost.
      encodePyramid(encoder) {
        if (disposed || !bindGroup || !pyramid) return;
        encodeHizPyramid(
          encoder,
          gpu.width,
          gpu.height,
          bindGroup,
          copyPipeline,
          reducePipeline,
          sizes,
          MAX_LEVELS,
          UNIFORM_BYTES,
          WORKGROUP,
        );
      },
      encodeTest(queueDevice, encoder, next, rows, boundsCount, flagRows) {
        if (disposed || !bindGroup) return 0;
        const count = Math.min(boundsCount, cap);
        if (flagRows > 0) encoder.clearBuffer(flags, 0, Math.min(cap, flagRows) * 4);
        const testBytes = packBounds(next, rows, count, gpu.width, gpu.height, sizes, offsets);
        if (count) queueDevice.queue.writeBuffer(bounds, 0, testBytes, 0, count * 32);
        const biasBits = new Uint32Array(new Float32Array([0]).buffer)[0];
        const testSlot = MAX_LEVELS + 1;
        writeUni(
          queueDevice,
          uniforms,
          uniData,
          [gpu.width, gpu.height, count, biasBits],
          testSlot * UNIFORM_BYTES,
        );
        const pass = encoder.beginComputePass({ label: 'WG HiZ test' });
        pass.setPipeline(testPipeline);
        pass.setBindGroup(0, bindGroup, [testSlot * UNIFORM_BYTES]);
        pass.dispatchWorkgroups(Math.max(1, Math.ceil(count / TEST_WORKGROUP)));
        pass.end();
        return count;
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
    await cleanupFailedHiz(device, buffers, level0, pyramid);
    return undefined;
  }
}
