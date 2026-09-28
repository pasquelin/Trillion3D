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
 * made by the first image that holds one: a scene without a filtering blend never compiles it.
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
  const twins: Partial<Record<TaaResolveKind, Resolve>> = {};
  const twin = (kind: TaaResolveKind): Resolve => {
    const flagged = kind !== 'flagless',
      layout = createTaaLayout(device, flagged, kind === 'blended', true);
    const module = device.createShaderModule({
      label: 'TAA_RESOLVE_FILTERED',
      code: taaShader(flagged, kind === 'blended', true),
    });
    const formats = ['rgba16float', SHARE_FORMAT, FILTER_FORMAT] as const;
    const pipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: { module, entryPoint: 'fullscreen' },
      fragment: { module, entryPoint: 'resolve', targets: formats.map((format) => ({ format })) },
      primitive: { topology: 'triangle-list' },
    });
    return { layout, pipeline };
  };
  return {
    asIs,
    flagless,
    blended,
    filtered: (kind: TaaResolveKind) => (twins[kind] ??= twin(kind)),
  };
}
