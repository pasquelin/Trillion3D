import { scissorTo } from './bounds.ts';
import { depthRestoreWgsl } from '../../gpu/core/depthRestoreWgsl.ts';
import { createCheckedShaderModule } from '../../gpu/core/shaderModule.ts';
import { staticLayerEntries } from '../../gpu/shadow/staticLayer.ts';
import { FULLSCREEN_VERTEX } from '../../lighting/deferred/shaders.ts';
import { buildRenderPipeline } from '../../lighting/deferred/fullscreen.ts';

const WATER_DEPTH_RESTORE = 'Trillion3D water depth restore';
/** The fullscreen triangle writing each texel's own opaque depth. */
const WATER_DEPTH_RESTORE_SHADER = FULLSCREEN_VERTEX + depthRestoreWgsl(0);
/** WebGPU forbids cropped depth texture copies. Restore texels through the same fragment as
 * shadow pages instead; the target outside this scissor is neither sampled nor depth-tested. */
export async function createWaterDepthRestore(device: GPUDevice) {
  const module = await createCheckedShaderModule(
    device,
    WATER_DEPTH_RESTORE_SHADER,
    'WATER_DEPTH_RESTORE',
  );
  const layout = device.createBindGroupLayout({ entries: staticLayerEntries() });
  const pipeline = await buildRenderPipeline(device, {
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    vertex: { module, entryPoint: 'fullscreen' },
    fragment: { module, entryPoint: 'restore_fs', targets: [] },
    primitive: { topology: 'triangle-list' },
    depthStencil: { format: 'depth32float', depthCompare: 'always', depthWriteEnabled: true },
  });
  let group: GPUBindGroup | undefined;
  const depth: GPURenderPassDepthStencilAttachment = {
    view: undefined as unknown as GPUTextureView,
    depthLoadOp: 'load',
    depthStoreOp: 'store',
  };
  const descriptor: GPURenderPassDescriptor = {
    label: WATER_DEPTH_RESTORE,
    colorAttachments: [],
    depthStencilAttachment: depth,
  };
  return {
    bind(source: GPUTextureView, target: GPUTextureView) {
      group = device.createBindGroup({ layout, entries: [{ binding: 0, resource: source }] });
      depth.view = target;
    },
    encode(encoder: GPUCommandEncoder, rect: Float64Array) {
      const pass = encoder.beginRenderPass(descriptor);
      scissorTo(pass, rect);
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, group!);
      pass.draw(3);
      pass.end();
    },
    dispose() {
      group = undefined;
    },
  };
}
