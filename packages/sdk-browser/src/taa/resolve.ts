import { createCheckedShaderModule } from '../gpu/core/shaderModule.ts';
import { makeFullscreenPipeline } from '../lighting/deferred/fullscreen.ts';
import { FILTER_FORMAT } from '../webgpu/blend/displayFilter.ts';
import { createTaaLayout, taaShader } from './shaderWgsl.ts';
import { taaUpscaleShader } from './upscaleWgsl.ts';

/** Format of the as-is share accumulated beside the colour: one channel, filtered like it. */
export const SHARE_FORMAT: GPUTextureFormat = 'r8unorm';

type TaaResolveKind = 'asIs' | 'flagless' | 'blended';

/**
 * The pass's resolves, all compiled at preparation, so a frame that switches compiles nothing: the
 * one of a frame with an as-is pixel, the flagless one, which binds and reads neither the surface
 * flags nor the share history (OMB-11), and the blended one. The same three again reconstruct a
 * frame drawn below the display (`upscaleWgsl.ts`): compiled at preparation with `upscale` — a
 * session asking a scale below 1 —, otherwise off the frame when `upscaled` is first asked, which
 * answers `undefined` till then. A `filtered` twin, resolving the display layers too
 * (`layers.ts`), compiles off the frame when first asked: `undefined` till then.
 */
export async function createTaaResolves(device: GPUDevice, upscale = false) {
  // One layout per kind and filter, shared by its native and upscaling resolves.
  const layouts: Record<string, GPUBindGroupLayout> = {};
  const resolve = async (kind: TaaResolveKind, scaled: boolean, filtered = false) => {
    const asIs = kind !== 'flagless',
      blended = kind === 'blended',
      layout = (layouts[kind + filtered] ??= createTaaLayout(device, asIs, blended, filtered)),
      label = blended ? 'TAA_RESOLVE_BLENDED' : asIs ? 'TAA_RESOLVE' : 'TAA_RESOLVE_FLAGLESS',
      name = label + (scaled ? '_UPSCALE' : '') + (filtered ? '_FILTERED' : '');
    const module = await createCheckedShaderModule(
      device,
      (scaled ? taaUpscaleShader : taaShader)(asIs, blended, filtered),
      name,
    );
    const targets: GPUColorTargetState[] = [{ format: 'rgba16float' }, { format: SHARE_FORMAT }];
    if (filtered) targets.push({ format: FILTER_FORMAT }, { format: FILTER_FORMAT });
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
  let upscaledSet: Awaited<ReturnType<typeof set>> | undefined,
    compiling: Promise<void> | undefined;
  const upscaled = () => {
    if (!compiling) {
      compiling = set(true).then((made) => void (upscaledSet = made));
      // Asked off the frame, a set that fails to compile leaves it at the display's size.
      compiling.catch(() => {});
    }
    return upscaledSet;
  };
  if (upscale) upscaled();
  const native = await set(false);
  // Asked at preparation, a failure refuses the pass, as the native set's does.
  if (upscale) await compiling;
  const twins = new Map<string, Awaited<ReturnType<typeof resolve>> | undefined>();
  const filtered = (kind: TaaResolveKind, scaled: boolean) => {
    const key = kind + scaled;
    if (!twins.has(key)) {
      twins.set(key, undefined);
      // A twin that fails to compile leaves the raw layers composed, never an unhandled rejection.
      resolve(kind, scaled, true).then(
        (made) => void twins.set(key, made),
        () => {},
      );
    }
    return twins.get(key);
  };
  return { ...native, upscaled, filtered };
}
