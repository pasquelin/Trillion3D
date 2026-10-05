import { createRadianceMipChain } from '../../../packages/sdk-browser/src/texture/mipBatch.ts';
import { mipLevelCountFor } from '../../../packages/sdk-browser/src/texture/tiles.ts';
import { readGpuBuffer } from '../../../packages/sdk-browser/src/gpu/core/readback.ts';
import { openGpuDevice } from '../kit/webgpuDevice.ts';

/** The engine's radiance mip chain on four HDR images, the last level of each read back. */
export async function run() {
  const opened = await openGpuDevice();
  if (!opened) throw new Error('no WebGPU adapter');
  const { device, errors } = opened;
  const shader = device.createShaderModule({
    code: `
 @group(0) @binding(0) var image:texture_2d<f32>;
 @group(0) @binding(1) var<storage,read_write> output:vec4f;
 @compute @workgroup_size(1) fn main(){output=textureLoad(image,vec2i(0),0);}`,
  });
  const pipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module: shader, entryPoint: 'main' },
  });
  const values: number[][] = [];
  for (const [width, height, edge] of [
    [8, 8, 0],
    [7, 5, 1],
    [9, 1, 1],
    [1, 9, 1],
  ]) {
    const levels = mipLevelCountFor(width, height);
    const texture = device.createTexture({
      size: [width, height],
      format: 'rgba16float',
      mipLevelCount: levels,
      usage:
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const data = new Uint16Array(width * height * 4);
    for (let pixel = 0; pixel < width * height; pixel++)
      data.set([0x3c00, 0x4000, 0x4400, 0x3c00], pixel * 4);
    if (edge) data.set([0x4c00, 0x5000, 0x5400, 0], data.length - 4);
    device.queue.writeTexture({ texture }, data, { bytesPerRow: width * 8 }, [width, height]);
    const chain = createRadianceMipChain(device, texture);
    const output = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    const group = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        {
          binding: 0,
          resource: texture.createView({ baseMipLevel: levels - 1, mipLevelCount: 1 }),
        },
        { binding: 1, resource: { buffer: output } },
      ],
    });
    const encoder = device.createCommandEncoder();
    chain.encode(encoder);
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group);
    pass.dispatchWorkgroups(1);
    pass.end();
    device.queue.submit([encoder.finish()]);
    values.push(Array.from(new Float32Array((await readGpuBuffer(device, output, 16))!.buffer)));
    output.destroy();
    chain.dispose();
    texture.destroy();
  }
  await opened.fermer();
  return { values, errors };
}
