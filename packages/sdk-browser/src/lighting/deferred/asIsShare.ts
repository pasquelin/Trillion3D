import { AS_IS_FLAG } from '../../scene/surfaceModel.ts';
import { FULLSCREEN_VERTEX } from './shaders.ts';

/** The current image's debug-view share, seeded from opaque flags before transparents blend it. */
export function createAsIsShare(
  device: GPUDevice,
  flags: GPUTextureView,
  width: number,
  height: number,
) {
  const texture = device.createTexture({
    label: 'Trillion3D current as-is share',
    size: { width, height },
    format: 'r8unorm',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  const view = texture.createView();
  const module = device.createShaderModule({
    code: `${FULLSCREEN_VERTEX}
@group(0) @binding(0) var flags:texture_2d<u32>;
@fragment fn seed(@builtin(position) pixel:vec4f)->@location(0) f32{
 return f32(textureLoad(flags,vec2i(pixel.xy),0).r==${AS_IS_FLAG}u);
}`,
  });
  const layout = device.createBindGroupLayout({
    entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'uint' } }],
  });
  const pipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    vertex: { module, entryPoint: 'fullscreen' },
    fragment: { module, entryPoint: 'seed', targets: [{ format: 'r8unorm' }] },
    primitive: { topology: 'triangle-list' },
  });
  const group = device.createBindGroup({ layout, entries: [{ binding: 0, resource: flags }] });
  return {
    view,
    seed(encoder: GPUCommandEncoder) {
      const pass = encoder.beginRenderPass({
        label: 'Trillion3D as-is share seed',
        colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, group);
      pass.draw(3);
      pass.end();
    },
    dispose: () => texture.destroy(),
  };
}

export type AsIsShare = ReturnType<typeof createAsIsShare>;
