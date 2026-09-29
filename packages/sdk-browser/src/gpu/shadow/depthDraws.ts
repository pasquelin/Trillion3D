import { DEPTH_COMPARE } from '../../camera/depthConvention.ts';
import { preparedPipeline } from '../../lighting/deferred/fullscreen.ts';

/**
 * The pool's draws of a region's casters (#965), one pipeline layout and the depth shader's entry
 * points (`shader.ts`): `opaque`, the casters no fragment can cut, with no fragment stage;
 * `envelope`, the same list for a face whose emitter envelope the fragment discards; `cutout`, the
 * cutout casters, with the fragment test; and both lists of a page the GPU drew from its own list,
 * placed in the vertex stage and kept to its page by the fragment (`fresh*`, #1275). Compiled off the frame by `prepare`, at prepare's shadow
 * pipelines step, or at once by `made` for a draw prepare did not compile (`preparedPipeline`).
 */
export function shadowDepthDraws(
  device: GPUDevice,
  module: GPUShaderModule,
  layout: GPUPipelineLayout,
) {
  const pipeline = (label: string, entryPoint: string, fragment: string | false) =>
    preparedPipeline(device, {
      label,
      layout,
      vertex: { module, entryPoint },
      // No colour target: the fragment stage exists only to discard an opacity-mask cutout or the
      // emitter envelope, and returns nothing.
      ...(fragment && { fragment: { module, entryPoint: fragment, targets: [] } }),
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: {
        format: 'depth32float',
        depthWriteEnabled: true,
        depthCompare: DEPTH_COMPARE,
      },
    });
  const draws = {
    opaque: pipeline('Trillion3D shadow depth only v1', 'shadow_depth_vs', false),
    envelope: pipeline('Trillion3D shadow depth v1', 'shadow_vs', 'shadow_fs'),
    cutout: pipeline('Trillion3D shadow depth cutout v1', 'shadow_cutout_vs', 'shadow_fs'),
    freshOpaque: pipeline('Trillion3D shadow GPU page v1', 'shadow_fresh_vs', 'shadow_fresh_fs'),
    freshCutout: pipeline(
      'Trillion3D shadow GPU page cutout v1',
      'shadow_fresh_cutout_vs',
      'shadow_fresh_fs',
    ),
  };
  let made: ShadowDepthDraws | undefined;
  return {
    prepare: () => Promise.all(Object.values(draws).map((draw) => draw.prepare())),
    made: (): ShadowDepthDraws =>
      (made ??= {
        opaque: draws.opaque.get(),
        envelope: draws.envelope.get(),
        cutout: draws.cutout.get(),
        freshOpaque: draws.freshOpaque.get(),
        freshCutout: draws.freshCutout.get(),
      }),
  };
}

/** The pool's draws, made (`shadowDepthDraws`). */
export type ShadowDepthDraws = Readonly<
  Record<'opaque' | 'envelope' | 'cutout' | 'freshOpaque' | 'freshCutout', GPURenderPipeline>
>;
