import { createDepthBoundsMipChain } from '../../../packages/sdk-browser/src/texture/mipBatch.ts';
import { levelSize, mipLevelCountFor } from '../../../packages/sdk-browser/src/texture/tiles.ts';

/** Test actual depth attachment reads and reduction, including odd borders and empty tiles. */
export async function run() {
  const opened = await globalThis.openGpuDevice();
  if (!opened) throw new Error('WebGPU unavailable');
  const { device, errors } = opened;
  const values: number[][] = [];
  for (const [width, height] of [
    [7, 5],
    [9, 1],
    [1, 9],
  ]) {
    const depth = device.createTexture({
      size: [width, height],
      format: 'depth32float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    const [w, h] = levelSize(width, height, 1);
    const levels = mipLevelCountFor(w, h);
    const bounds = device.createTexture({
      size: [w, h],
      format: 'rg32float',
      mipLevelCount: levels,
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_SRC,
    });
    const module = device.createShaderModule({
      code: `
 @vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f{
  return vec4f(f32(i32(i&1u)*4-1),f32(i32(i>>1u)*4-1),0.0,1.0);
 }
 @fragment fn fs(@builtin(position) p:vec4f)->@builtin(frag_depth) f32{
  if(p.x<1.0&&p.y<1.0){return 0.25;}
  if(p.x>${width - 1}.0&&p.y>${height - 1}.0){return 0.875;}
  return 0.0;
 }`,
    });
    const pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [] },
      depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'always' },
    });
    const chain = createDepthBoundsMipChain(device, bounds, {
      view: depth.createView(),
      width,
      height,
    });
    const readback = device.createBuffer({
      size: 256,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [],
      depthStencilAttachment: {
        view: depth.createView(),
        depthClearValue: 0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });
    pass.setPipeline(pipeline);
    pass.draw(3);
    pass.end();
    chain.encode(encoder);
    encoder.copyTextureToBuffer(
      { texture: bounds, mipLevel: levels - 1 },
      { buffer: readback, bytesPerRow: 256 },
      [1, 1],
    );
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    values.push(Array.from(new Float32Array(readback.getMappedRange()).slice(0, 2)));
    readback.unmap();
    readback.destroy();
    chain.dispose();
    bounds.destroy();
    depth.destroy();
  }
  await opened.fermer();
  return { values, errors };
}
