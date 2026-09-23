import { LIGHT_SETTINGS } from '../../../../sdk-core/src/index.ts';
import { createCheckedShaderModule } from '../core/shaderModule.ts';

/**
 * THE STATIC LAYER of the shadow pool: a second depth texture of the pool's size, where each page
 * keeps the depth of its static casters alone. A page whose moving casters changed is restored from
 * it — one full-page triangle that writes each texel's depth — and its moving casters drawn over:
 * the static geometry under a moving object is never drawn again for it.
 *
 * It exists from the first move of an object on (`../../webgpu/shadow/mobility.ts`): a scene where
 * nothing moves pays neither its 64 MiB nor its pass.
 */
/** Label of the pass that fills the static layer: timed with the Shadows stage. */
export const SHADOW_LAYER_PASS = 'WG shadow static layer v1';

const RESTORE_WGSL = `@group(0) @binding(0) var layer:texture_depth_2d;
@vertex fn restore_vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f{
 return vec4f(f32(i32(i&1u)*4-1),f32(i32(i>>1u)*4-1),0.0,1.0);
}
/** The viewport is the page in the pool and in the layer alike: a texel reads its own twin. */
@fragment fn restore_fs(@builtin(position) p:vec4f)->@builtin(frag_depth) f32{
 return textureLoad(layer,vec2i(p.xy),0);
}`;

export async function createShadowStaticLayer(device: GPUDevice) {
  const size = LIGHT_SETTINGS.shadowAtlasSize;
  const texture = device.createTexture({
    label: 'WG shadow static layer v1',
    size: [size, size, 1],
    format: 'depth32float',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  try {
    const module = await createCheckedShaderModule(device, RESTORE_WGSL, 'SHADOW_RESTORE');
    const layout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
      ],
    });
    const view = texture.createView();
    const restore = device.createRenderPipeline({
      label: 'WG shadow page restore v1',
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: { module, entryPoint: 'restore_vs' },
      fragment: { module, entryPoint: 'restore_fs', targets: [] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'always' },
    });
    const group = device.createBindGroup({ layout, entries: [{ binding: 0, resource: view }] });
    return {
      view,
      restore,
      group,
      bytes: size * size * 4,
      dispose() {
        texture.destroy();
      },
    };
  } catch (error) {
    texture.destroy();
    throw error;
  }
}

export type ShadowStaticLayer = Awaited<ReturnType<typeof createShadowStaticLayer>>;
