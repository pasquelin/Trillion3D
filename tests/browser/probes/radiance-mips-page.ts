import { createRadianceMipChain } from '../../../packages/sdk-browser/src/texture/mipBatch.ts';
import { mipLevelCountFor } from '../../../packages/sdk-browser/src/texture/tiles.ts';

/** Numeric diagnostic of the actual render reduction, including its resource owner. */
export async function run() {
  const opened = await globalThis.openGpuDevice();
  if (!opened) throw new Error('WebGPU unavailable');
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
    const readback = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
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
    encoder.copyBufferToBuffer(output, 0, readback, 0, 16);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    values.push(Array.from(new Float32Array(readback.getMappedRange())));
    readback.unmap();
    readback.destroy();
    output.destroy();
    chain.dispose();
    texture.destroy();
  }
  await opened.fermer();
  return { values, errors };
}
