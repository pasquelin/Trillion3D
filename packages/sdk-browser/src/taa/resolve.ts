import { createCheckedShaderModule } from '../gpu/core/shaderModule.ts';
import { makeFullscreenPipeline } from '../lighting/deferred/fullscreen.ts';
import { FILTER_FORMAT } from '../webgpu/blend/displayFilter.ts';
import { createTaaLayout, taaShader } from './shaderWgsl.ts';

/** Format of the as-is share accumulated beside the colour: one channel, filtered like it. */
export const SHARE_FORMAT: GPUTextureFormat = 'r8unorm';

type Resolve = { layout: GPUBindGroupLayout; pipeline: GPURenderPipeline };
export type TaaResolveKind = 'asIs' | 'flagless' | 'blended';

/**
 * The pass's three resolves, compiled at preparation, so a frame that switches compiles nothing:
 * the one of a frame with an as-is pixel, the flagless one, which binds and reads neither the
 * surface flags nor the share history (OMB-11), and the one reading the blended share. Each has
 * a `filtered` twin that resolves the display filter too (`../webgpu/blend/displayFilter.ts`),
 * compiled off the frame from the first image that holds one — `undefined` until it is ready, the
 * image then composing the raw filter —: a scene without a filtering blend never compiles it.
 */
export async function createTaaResolves(device: GPUDevice) {
  const resolve = async (asIs: boolean, blended = false, filtered = false): Promise<Resolve> => {
    const layout = createTaaLayout(device, asIs, blended, filtered),
      name =
        (blended ? 'TAA_RESOLVE_BLENDED' : asIs ? 'TAA_RESOLVE' : 'TAA_RESOLVE_FLAGLESS') +
        (filtered ? '_FILTERED' : '');
    const module = await createCheckedShaderModule(
      device,
      taaShader(asIs, blended, filtered),
      name,
    );
    const targets: GPUColorTargetState[] = [{ format: 'rgba16float' }, { format: SHARE_FORMAT }];
    if (filtered) targets.push({ format: FILTER_FORMAT }, { format: FILTER_FORMAT });
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
  const twins: Partial<Record<TaaResolveKind, Resolve>> = {},
    compiling = new Set<TaaResolveKind>();
  const filtered = (kind: TaaResolveKind) => {
    if (!twins[kind] && !compiling.has(kind)) {
      compiling.add(kind);
      void resolve(kind !== 'flagless', kind === 'blended', true).then(
        (made) => void (twins[kind] = made),
      );
    }
    return twins[kind];
  };
  return { asIs, flagless, blended, filtered };
}
