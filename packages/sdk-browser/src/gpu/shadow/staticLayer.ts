import { SHADOW_PAGE } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { createCheckedShaderModule } from '../core/shaderModule.ts';
import { SHADOW_TRANSMITTANCE_FORMAT, TRANSMITTANCE_CLEAR_WGSL } from './transmittance.ts';

/** Label of the pass that fills the static layer: timed with the Shadows stage. */
export const SHADOW_LAYER_PASS = 'Trillion3D shadow static layer v1';

const RESTORE_WGSL = `@group(0) @binding(0) var layer:texture_depth_2d;
@vertex fn restore_vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f{
 return vec4f(f32(i32(i&1u)*4-1),f32(i32(i>>1u)*4-1),0.0,1.0);
}
/** The viewport is the page in the pool and in the layer alike: a texel reads its own twin. */
@fragment fn restore_fs(@builtin(position) p:vec4f)->@builtin(frag_depth) f32{
 return textureLoad(layer,vec2i(p.xy),0);
}
struct Restored{@builtin(frag_depth) depth:f32,@location(0) transmittance:vec4f,}
/** The same, the transmittance layer attached: the layer keeps no translucent caster — their rows
 *  count as moving —, so the page starts from all the light. */
@fragment fn restore_transmit_fs(@builtin(position) p:vec4f)->Restored{
 return Restored(textureLoad(layer,vec2i(p.xy),0),${TRANSMITTANCE_CLEAR_WGSL});
}`;

/**
 * THE STATIC LAYER of the shadow pool: a second depth texture of the pool's size, `poolSide` pages
 * a side, where each page keeps the depth of its static casters alone, at the same place. A page
 * whose moving casters changed is restored from it — one full-page triangle that writes each
 * texel's depth — and its moving casters drawn over: the static geometry under a moving object is
 * never drawn again for it.
 *
 * It exists from the first move of an object on (`../../webgpu/shadow/mobility.ts`): a scene where
 * nothing moves pays neither its bytes — as many as the pool's — nor its pass.
 */
export async function createShadowStaticLayer(device: GPUDevice, poolSide: number) {
  const size = poolSide * SHADOW_PAGE;
  const texture = device.createTexture({
    label: 'Trillion3D shadow static layer v1',
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
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
    const restorePipeline = (entryPoint: string, targets: GPUColorTargetState[]) =>
      device.createRenderPipeline({
        label: 'Trillion3D shadow page restore v1',
        layout: pipelineLayout,
        vertex: { module, entryPoint: 'restore_vs' },
        fragment: { module, entryPoint, targets },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'always' },
      });
    const restore = restorePipeline('restore_fs', []);
    const restoreTransmit = restorePipeline('restore_transmit_fs', [
      { format: SHADOW_TRANSMITTANCE_FORMAT },
    ]);
    const group = device.createBindGroup({ layout, entries: [{ binding: 0, resource: view }] });
    return {
      view,
      restore,
      /** `restore` with the transmittance layer attached (`transmittance.ts`). */
      restoreTransmit,
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
