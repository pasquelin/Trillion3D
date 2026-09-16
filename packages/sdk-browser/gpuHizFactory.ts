import { encodeHizPyramid } from './gpuHizPyramid.ts';
import { pyramidBytes, writeHizLevelUniforms, writeUni } from './gpuHizUniforms.ts';
import { cleanupFailedHiz, createHizPipelines } from './gpuHizPipelines.ts';
import { TESTED_U32 } from './gpuPartitionContract.ts';
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
    // Les boîtes testées et l'état de l'image appartiennent à la partition GPU, qui n'existe pas
    // encore : jusqu'à `attach`, le groupe de liaison pointe sur ce tampon de veille, que rien ne lit.
    const idle = device.createBuffer({
      label: 'WG HiZ idle bounds v1',
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
      writeHizLevelUniforms(
        device,
        uniforms,
        levelWords,
        sizes,
        offsets,
        w,
        h,
        MAX_LEVELS,
        UNIFORM_BYTES,
      );
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
      /** Les boîtes testées et l'état de l'image viennent de la partition GPU, montée après nous. */
      attach(nextBounds: GPUBuffer, nextState: GPUBuffer) {
        bounds = nextBounds;
        state = nextState;
        if (pyramid && level0View) bind(pyramid, level0View);
      },
      /** Les mips de la pyramide, avec leur décalage et leur largeur : ce que la partition lit pour
       *  exprimer un rectangle d'écran en texels du mip qui le couvre exactement. */
      levels: () => sizes.map((size, level) => ({ offset: offsets[level], width: size[0] })),
      encodeTest(queueDevice, encoder, maxRows, flagRows) {
        if (disposed || !bindGroup || bounds === idle) return 0;
        const rows = Math.min(maxRows, cap);
        if (flagRows > 0) encoder.clearBuffer(flags, 0, Math.min(cap, flagRows) * 4);
        const biasBits = new Uint32Array(new Float32Array([0]).buffer)[0];
        const testSlot = MAX_LEVELS + 1;
        writeUni(
          queueDevice,
          uniforms,
          uniData,
          [gpu.width, gpu.height, rows, biasBits],
          testSlot * UNIFORM_BYTES,
        );
        // Le nombre de boîtes compactées vit dans l'état : le lancement couvre toutes les lignes
        // dessinables et les fils au-delà du compte sortent au premier test.
        const pass = encoder.beginComputePass({ label: 'WG HiZ test' });
        pass.setPipeline(testPipeline);
        pass.setBindGroup(0, bindGroup, [testSlot * UNIFORM_BYTES]);
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
    await cleanupFailedHiz(device, buffers, level0, pyramid);
    return undefined;
  }
}
