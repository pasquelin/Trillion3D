import { sharedGpuDevice } from '../gpu/core/sessionHandle.ts';
import { uniformStride } from '../residency/pools.ts';
import { levelSize, mipLevelCountFor } from './tiles.ts';
import { countCoverage, LEVEL_BIN_BYTES, type CoverageChain } from './coverageMips.ts';
import { heldBuffer, mipPipeline } from './mips.ts';
import { REFLECTION_RADIANCE_MIPS_PASS, TEXTURE_MIPS_PASS } from './mipsPass.ts';

/** One texture of a batch: its size, its colour rule — weighted by alpha when every reader takes
 *  alpha for coverage, in straight alpha (`../webgpu/tile/scratch.ts`) — and its readers' cutoff
 *  (`CoverageReaders.cutoff`), 0 for none. */
export type MipChain = {
  texture: GPUTexture;
  format: GPUTextureFormat;
  width: number;
  height: number;
  weighted: boolean;
  cutoff?: number;
};

/** Generates the mip chains of 2D textures: averaged colour, median alpha so that threshold
 * coverage survives every level, scaled to keep level 0's share at the cutoff when there is one.
 * A batch is one uniform write, one encoder and one submit (OMB-29, #961): each chain's passes are
 * the ones it had alone, in order, so every level holds the same bytes.
 * Commands are submitted without being awaited: the device queue runs them in order, therefore
 * before any copy that will read a level. */
export function generateMaterialMips(device: GPUDevice, chains: MipChain[]) {
  // Each chain's levels, and its first uniform block: one per level, after the previous chain's.
  const reduced: Array<{ chain: MipChain; levels: number; first: number }> = [];
  let blocks = 0;
  for (const chain of chains) {
    const levels = mipLevelCountFor(chain.width, chain.height);
    if (levels === 1) continue;
    reduced.push({ chain, levels, first: blocks });
    blocks += levels;
  }
  if (!reduced.length) return;
  const shared = sharedGpuDevice(device);
  const stride = uniformStride(device.limits);
  // A block holds its level's reduction: the extent of the source level, so as not to read off the
  // image, and the cutoff; for the counts, level 0's extent and the level. Block 0 is level 0's own
  // count.
  const packed = new Uint32Array((blocks * stride) / 4);
  for (const { chain, levels, first } of reduced) {
    const { width, height, cutoff = 0 } = chain;
    for (let level = 0; level < levels; level++) {
      const source = levelSize(width, height, Math.max(0, level - 1));
      packed.set([...source, cutoff, 0, width, height, level], ((first + level) * stride) / 4);
    }
  }
  const uniforms = heldBuffer(
    shared,
    'Trillion3D texture mips uniforms',
    packed.byteLength,
    GPUBufferUsage.UNIFORM,
  );
  device.queue.writeBuffer(uniforms, 0, packed);
  const encoder = device.createCommandEncoder();
  for (const { chain, levels, first } of reduced)
    encodeChain(device, shared, encoder, chain, levels, { uniforms, first, stride });
  device.queue.submit([encoder.finish()]);
}

/** One chain's passes into `encoder`, its uniform blocks from block `first`. */
function encodeChain(
  device: GPUDevice,
  shared: GPUDevice,
  encoder: GPUCommandEncoder,
  { texture, format, width, height, weighted, cutoff = 0 }: MipChain,
  levels: number,
  { uniforms, first, stride }: { uniforms: GPUBuffer; first: number; stride: number },
) {
  const { layout, pipeline } = mipPipeline(shared, format, weighted);
  const views = levelViews(texture, levels);
  let chain: CoverageChain | undefined;
  if (cutoff) {
    const size = levels * LEVEL_BIN_BYTES,
      usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC;
    // The bins are the device's: a batch clears them before each chain, in the encoder's order.
    const bins = heldBuffer(shared, 'Trillion3D coverage bins', size, usage);
    encoder.clearBuffer(bins, 0, size);
    chain = { width, height, views, uniforms, first, stride, bins };
  }
  for (let level = 1; level < levels; level++) {
    if (chain) countCoverage(device, encoder, chain, level);
    const group = device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: views[level - 1] },
        { binding: 1, resource: { buffer: uniforms, offset: (first + level) * stride, size: 16 } },
      ],
    });
    encodeMipPass(encoder, pipeline, group, views[level], TEXTURE_MIPS_PASS);
  }
}

/** The views of `texture`'s first `count` mip levels, one a level. */
export const levelViews = (texture: GPUTexture, count = texture.mipLevelCount) =>
  Array.from({ length: count }, (_, level) =>
    texture.createView({ baseMipLevel: level, mipLevelCount: 1 }),
  );

/** The uniform of a chain of `count` reductions over a `width × height` image — block `index`
 *  holds source level `index`'s size, then the image's — and a bind group per reduction, `group`
 *  given its block. A frame source keeps both; its owner admits the buffer before construction,
 *  and a group that throws releases it. */
export function reductionGroups(
  device: GPUDevice,
  label: string,
  [width, height]: readonly [number, number],
  count: number,
  group: (index: number, extent: GPUBufferBinding) => GPUBindGroup,
) {
  const stride = uniformStride(device.limits);
  const uniforms = device.createBuffer({
    label,
    size: Math.max(1, count) * stride,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  try {
    const packed = new Uint32Array(uniforms.size / 4);
    const groups = Array.from({ length: count }, (_, index) => {
      packed.set([...levelSize(width, height, index), width, height], (index * stride) / 4);
      return group(index, { buffer: uniforms, offset: index * stride, size: 16 });
    });
    device.queue.writeBuffer(uniforms, 0, packed);
    return { uniforms, groups };
  } catch (error) {
    uniforms.destroy();
    throw error;
  }
}

/** The radiance levels a reflection cone reads (`../reflections/conePyramid.ts`), each reduced
 *  from the one above; encoding never allocates or submits. */
export function createRadianceMipChain(device: GPUDevice, texture: GPUTexture) {
  const program = mipPipeline(sharedGpuDevice(device), texture.format, false, 'radiance');
  const views = levelViews(texture);
  const { uniforms, groups } = reductionGroups(
    device,
    'Trillion3D radiance mip extents',
    [texture.width, texture.height],
    views.length - 1,
    (index, extent) =>
      device.createBindGroup({
        layout: program.layout,
        entries: [
          { binding: 0, resource: views[index] },
          { binding: 1, resource: extent },
        ],
      }),
  );
  return {
    encode(encoder: GPUCommandEncoder) {
      for (let index = 0; index < groups.length; index++)
        encodeMipPass(
          encoder,
          program.pipeline,
          groups[index],
          views[index + 1],
          REFLECTION_RADIANCE_MIPS_PASS,
        );
    },
    dispose() {
      uniforms.destroy();
    },
  };
}

function encodeMipPass(
  encoder: GPUCommandEncoder,
  pipeline: GPURenderPipeline,
  group: GPUBindGroup,
  view: GPUTextureView,
  label: string,
) {
  const pass = encoder.beginRenderPass({
    label,
    colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }],
  });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, group);
  pass.draw(3);
  pass.end();
}
