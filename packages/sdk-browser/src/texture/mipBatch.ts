import { sharedGpuDevice } from '../gpu/core/sessionHandle.ts';
import { levelSize, mipLevelCountFor } from './tiles.ts';
import { countCoverage, LEVEL_BIN_BYTES, type CoverageChain } from './coverageMips.ts';
import { heldBuffer, mipPipeline } from './mips.ts';

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
  const reduced = chains.filter(({ width, height }) => mipLevelCountFor(width, height) > 1);
  if (!reduced.length) return;
  const shared = sharedGpuDevice(device);
  const stride = Math.max(256, device.limits.minUniformBufferOffsetAlignment ?? 256);
  // One uniform block per level, its reduction's: the extent of the source level, so as not to read
  // off the image, and the cutoff; for the counts, level 0's extent and the level. Block 0 is level
  // 0's own count. Each chain's blocks follow the previous chain's.
  const firsts: number[] = [];
  let blocks = 0;
  for (const { width, height } of reduced) {
    firsts.push(blocks);
    blocks += mipLevelCountFor(width, height);
  }
  const packed = new Uint32Array((blocks * stride) / 4);
  reduced.forEach(({ width, height, cutoff = 0 }, i) => {
    for (let level = 0; level < mipLevelCountFor(width, height); level++) {
      const source = levelSize(width, height, Math.max(0, level - 1));
      packed.set([...source, cutoff, 0, width, height, level], ((firsts[i] + level) * stride) / 4);
    }
  });
  const uniforms = heldBuffer(
    shared,
    'Trillion3D texture mips uniforms',
    packed.byteLength,
    GPUBufferUsage.UNIFORM,
  );
  device.queue.writeBuffer(uniforms, 0, packed);
  const encoder = device.createCommandEncoder();
  reduced.forEach((chain, i) => encodeChain(device, encoder, chain, uniforms, firsts[i], stride));
  device.queue.submit([encoder.finish()]);
}

/** One chain's passes into `encoder`, its uniform blocks from block `first`. */
function encodeChain(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  { texture, format, width, height, weighted, cutoff = 0 }: MipChain,
  uniforms: GPUBuffer,
  first: number,
  stride: number,
) {
  const shared = sharedGpuDevice(device);
  const { layout, pipeline } = mipPipeline(shared, format, weighted);
  const levels = mipLevelCountFor(width, height);
  const views = Array.from({ length: levels }, (_, level) =>
    texture.createView({ baseMipLevel: level, mipLevelCount: 1 }),
  );
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
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: views[level], loadOp: 'clear', storeOp: 'store' }],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group);
    pass.draw(3);
    pass.end();
  }
}
