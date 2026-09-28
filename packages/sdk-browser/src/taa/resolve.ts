import { createCheckedShaderModule } from '../gpu/core/shaderModule.ts';
import { makeFullscreenPipeline } from '../lighting/deferred/fullscreen.ts';
import { createTaaLayout, taaShader } from './shaderWgsl.ts';

/** Format of the as-is share accumulated beside the colour: one channel, filtered like it. */
export const SHARE_FORMAT: GPUTextureFormat = 'r8unorm';

/**
 * The pass's two resolves, both compiled at preparation, so a frame that switches compiles
 * nothing: the one of a frame with an as-is pixel, and the flagless one, which binds and reads
 * neither the surface flags nor the share history (OMB-11).
 */
export async function createTaaResolves(device: GPUDevice) {
  const resolve = async (asIs: boolean, blended = false) => {
    const layout = createTaaLayout(device, asIs, blended),
      name = blended ? 'TAA_RESOLVE_BLENDED' : asIs ? 'TAA_RESOLVE' : 'TAA_RESOLVE_FLAGLESS';
    const module = await createCheckedShaderModule(device, taaShader(asIs, blended), name);
    const targets = [{ format: 'rgba16float' as const }, { format: SHARE_FORMAT }];
    return {
      layout,
      pipeline: await makeFullscreenPipeline(device, module, layout, 'resolve', targets),
    };
  };
  const [asIs, flagless, blended] = await Promise.all([
    resolve(true),
    resolve(false),
    resolve(true, true),
  ]);
  return { asIs, flagless, blended };
}
