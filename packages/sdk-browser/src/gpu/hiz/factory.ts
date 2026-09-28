import { encodeHizPyramid } from './pyramid.ts';
import { pyramidBytes } from './oracle.ts';
import {
  HIZ_MAX_LEVELS,
  HIZ_PASS_LEVELS,
  HIZ_UNIFORM_BYTES as UNIFORM_BYTES,
  hizBuildPasses,
  hizBuildWords,
  writeHizTestUniforms,
  type HizBuildPass,
} from './uniforms.ts';
import { cleanupFailedHiz, createHizPipelines, hizPagesGroup } from './pipelines.ts';
import { TESTED_U32 } from '../partition/contract.ts';
import type { GpuHiz, HizPyramid } from './types.ts';
const TEST_WORKGROUP = 64;

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
    // The drawn view's pyramid; another view keeps its own while this one is drawn (`swap`).
    at: Pyramid | undefined,
    bindGroup: GPUBindGroup | undefined,
    // Bumped when the partition's buffers change: a pyramid's cached bind group is then stale.
    bindings = 0;
  try {
    const pipelines = await createHizPipelines(device);
    if (!pipelines) return undefined;
    const { layout, buildPipeline, testPipeline } = pipelines;
    const pagesGroup = hizPagesGroup(device, pipelines.pagesLayout);
    const uniforms = device.createBuffer({
      // The deepest pyramid's build passes, then the test's slot.
      size: UNIFORM_BYTES * (Math.ceil((HIZ_MAX_LEVELS - 1) / HIZ_PASS_LEVELS) + 1),
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
    /** The drawn pyramid's bind group, made once per pyramid and per `attach`, never per swap. */
    const bind = () => {
      if (!at) return void (bindGroup = undefined);
      if (at.group && at.bindings === bindings) return void (bindGroup = at.group);
      at.bindings = bindings;
      bindGroup = at.group = device.createBindGroup({
        layout,
        entries: [
          { binding: 0, resource: { buffer: at.pyramid } },
          { binding: 1, resource: at.level0View },
          { binding: 2, resource: { buffer: uniforms, size: UNIFORM_BYTES } },
          { binding: 3, resource: { buffer: bounds } },
          { binding: 4, resource: { buffer: flags } },
          { binding: 5, resource: { buffer: state } },
        ],
      });
    };
    /** Installs `next` as the drawn pyramid: bound, its build words written, its size published. */
    const install = (next: Pyramid | undefined) => {
      at = next;
      bind();
      gpu.width = next?.width ?? 0;
      gpu.height = next?.height ?? 0;
      if (!next) return;
      device.queue.writeBuffer(uniforms, 0, next.words);
      gpu.level0 = next.level0;
      gpu.level0View = next.level0View;
    };
    const first = (at = allocPyramid(device, level0Usage, width, height));
    const gpu: GpuHiz = {
      width: 0,
      height: 0,
      level0: first.level0,
      level0View: first.level0View,
      flags,
      // One compute pass builds the whole pyramid, four mips per dispatch (`buildHiz`).
      encodePyramid(encoder) {
        if (disposed || !bindGroup || !at) return;
        encodeHizPyramid(encoder, 'Trillion3D HiZ pyramid', bindGroup, buildPipeline, at.passes);
      },
      /** Tested boxes and the frame state come from the GPU partition, mounted after us. */
      attach(nextBounds: GPUBuffer, nextState: GPUBuffer) {
        bounds = nextBounds;
        state = nextState;
        bindings++;
        bind();
      },
      /** Pyramid mips, with their offset and width: what the partition reads to express a
       *  screen rectangle in texels of the mip that covers it exactly. */
      levels: () => at?.levels ?? [],
      pyramidBuffer: () => (disposed ? undefined : at?.pyramid),
      encodeTest(queueDevice, encoder, maxRows, flagRows, pages) {
        if (disposed || !bindGroup || !at || bounds === idle) return 0;
        const rows = Math.min(maxRows, cap);
        if (flagRows > 0) encoder.clearBuffer(flags, 0, Math.min(cap, flagRows) * 4);
        const slot = at.passes.length * UNIFORM_BYTES;
        writeHizTestUniforms(queueDevice, uniforms, testWords, slot, gpu.width, gpu.height, rows);
        // The compacted box count lives in the state: the dispatch covers every drawable row
        // and threads past the count leave at the first test.
        const pass = encoder.beginComputePass({ label: 'Trillion3D HiZ test' });
        pass.setPipeline(testPipeline);
        pass.setBindGroup(0, bindGroup, [slot]);
        pass.setBindGroup(1, pagesGroup(pages));
        pass.dispatchWorkgroups(Math.max(1, Math.ceil(rows / TEST_WORKGROUP)));
        pass.end();
        return rows;
      },
      resize(nextDevice, nextWidth, nextHeight) {
        if (disposed || !nextDevice || nextWidth < 1 || nextHeight < 1) return false;
        if (nextWidth === gpu.width && nextHeight === gpu.height && at) return true;
        try {
          // The drawn view's pyramid is replaced; another view's, held aside, is not touched.
          at?.destroy();
          install(allocPyramid(device, level0Usage, nextWidth, nextHeight));
          return true;
        } catch {
          return false;
        }
      },
      swap(next) {
        const current = at;
        if (!disposed) install(next as Pyramid | undefined);
        return current;
      },
      dispose() {
        disposed = true;
        for (const buffer of buffers) buffer.destroy();
        at?.destroy();
        at = bindGroup = undefined;
      },
    };
    install(first);
    return gpu;
  } catch {
    cleanupFailedHiz(buffers, at);
    return undefined;
  }
}

type Pyramid = HizPyramid & {
  level0: GPUTexture;
  level0View: GPUTextureView;
  pyramid: GPUBuffer;
  passes: HizBuildPass[];
  /** Build uniforms of this size, written again whenever the pyramid is installed. */
  words: ReturnType<typeof hizBuildWords>;
  /** Mips with their offset and width: they depend only on the size. */
  levels: Array<{ offset: number; width: number }>;
  /** Its bind group, and the `attach` generation it was made for. */
  group?: GPUBindGroup;
  bindings?: number;
};

/** One view's pyramid at `width × height`: its level 0 and its packed mips. */
function allocPyramid(device: GPUDevice, usage: number, width: number, height: number): Pyramid {
  const { sizes, offsets, bytes } = pyramidBytes(width, height),
    passes = hizBuildPasses(sizes);
  const level0 = device.createTexture({ size: { width, height }, format: 'r32float', usage });
  const pyramid = device.createBuffer({
    size: bytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  return {
    width,
    height,
    level0,
    level0View: level0.createView(),
    pyramid,
    passes,
    words: hizBuildWords(sizes, offsets, passes),
    levels: sizes.map((size, level) => ({ offset: offsets[level], width: size[0] })),
    destroy() {
      level0.destroy();
      pyramid.destroy();
    },
  };
}
