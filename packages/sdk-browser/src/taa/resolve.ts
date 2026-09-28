import { createCheckedShaderModule } from '../gpu/core/shaderModule.ts';
import { makeFullscreenPipeline } from '../lighting/deferred/fullscreen.ts';
import { createTaaLayout, taaShader } from './shaderWgsl.ts';
import { taaUpscaleShader } from './upscaleWgsl.ts';

/** Format of the as-is share accumulated beside the colour: one channel, filtered like it. */
export const SHARE_FORMAT: GPUTextureFormat = 'r8unorm';

/**
 * The pass's resolves, all compiled at preparation, so a frame that switches compiles nothing: the
 * one of a frame with an as-is pixel, the flagless one, which binds and reads neither the surface
 * flags nor the share history (OMB-11), and the blended one. With `upscale` — a session whose frame
 * is drawn below the display — the same three again, reconstructing to the display
 * (`upscaleWgsl.ts`); at native size they are never compiled.
 */
export async function createTaaResolves(device: GPUDevice, upscale = false) {
  // One layout per kind, shared by its native and upscaling resolves: a bind group serves both.
  const layouts = {
    asIs: createTaaLayout(device, true, false),
    flagless: createTaaLayout(device, false, false),
    blended: createTaaLayout(device, true, true),
  };
  const resolve = async (kind: keyof typeof layouts, scaled: boolean) => {
    const layout = layouts[kind],
      asIs = kind !== 'flagless',
      blended = kind === 'blended',
      label = blended ? 'TAA_RESOLVE_BLENDED' : asIs ? 'TAA_RESOLVE' : 'TAA_RESOLVE_FLAGLESS',
      name = scaled ? `${label}_UPSCALE` : label;
    const module = await createCheckedShaderModule(
      device,
      (scaled ? taaUpscaleShader : taaShader)(asIs, blended),
      name,
    );
    const targets = [{ format: 'rgba16float' as const }, { format: SHARE_FORMAT }];
    return {
      layout,
      pipeline: await makeFullscreenPipeline(device, module, layout, 'resolve', targets),
    };
  };
  const set = async (scaled: boolean) => {
    const [asIs, flagless, blended] = await Promise.all([
      resolve('asIs', scaled),
      resolve('flagless', scaled),
      resolve('blended', scaled),
    ]);
    return { asIs, flagless, blended };
  };
  const [native, upscaled] = await Promise.all([set(false), upscale ? set(true) : undefined]);
  return { ...native, upscale: upscaled };
}
