import { DEPTH_COMPARE } from '../../camera/depthConvention.ts';
import { preparedPipeline } from '../../lighting/deferred/fullscreen.ts';
import { casterPrimitive } from './casterPrimitive.ts';

/**
 * The pool's three draws of a region's casters (#965), one pipeline layout and the depth shader's
 * entry points (`shader.ts`): `opaque`, the casters no fragment can cut, with no fragment stage;
 * `envelope`, the same list for a face whose emitter envelope the fragment discards; `cutout`, the
 * cutout casters, with the fragment test. Compiled off the frame by `prepare`, at prepare's shadow
 * pipelines step, or at once by `made` for a draw prepare did not compile (`preparedPipeline`).
 */
export function shadowDepthDraws(
  device: GPUDevice,
  module: GPUShaderModule,
  layout: GPUPipelineLayout,
) {
  // A near or far plane the hardware clips a sun caster against mints unsnapped corners from the
  // snapped ones, whose sum with the pool origin rounds differently at each origin (#26);
  // `casterPrimitive` disables the clip on a device that allows it. A device without the feature
  // keeps the old path.
  const pipeline = (label: string, entryPoint: string, fragment: boolean) =>
    preparedPipeline(device, {
      label,
      layout,
      vertex: { module, entryPoint },
      // No colour target: the fragment stage exists only to discard an opacity-mask cutout or the
      // emitter envelope, and returns nothing.
      ...(fragment && { fragment: { module, entryPoint: 'shadow_fs', targets: [] } }),
      primitive: casterPrimitive(device, { topology: 'triangle-list', cullMode: 'none' }),
      depthStencil: {
        format: 'depth32float',
        depthWriteEnabled: true,
        depthCompare: DEPTH_COMPARE,
      },
    });
  // OMB-25 (#966): the same three draws from the stored LocalToClip (`storedWgsl.ts`), for the
  // `shadowLocalToClip` option alone; the default draws keep their entries.
  const set = (stored: boolean) => {
    const at = (entry: string) => (stored ? entry.replace(/_vs$/, '_stored_vs') : entry),
      name = stored ? ' stored' : '';
    return {
      opaque: pipeline(`Trillion3D shadow depth only${name} v1`, at('shadow_depth_vs'), false),
      envelope: pipeline(`Trillion3D shadow depth${name} v1`, at('shadow_vs'), true),
      cutout: pipeline(`Trillion3D shadow depth cutout${name} v1`, at('shadow_cutout_vs'), true),
    };
  };
  const sets = [set(false), set(true)];
  const made: Array<ShadowDepthDraws | undefined> = [];
  return {
    prepare: (stored = false) =>
      Promise.all(Object.values(sets[+stored]).map((draw) => draw.prepare())),
    made: (stored = false): ShadowDepthDraws =>
      (made[+stored] ??= {
        opaque: sets[+stored].opaque.get(),
        envelope: sets[+stored].envelope.get(),
        cutout: sets[+stored].cutout.get(),
      }),
  };
}

/** The pool's draws, made (`shadowDepthDraws`). */
export type ShadowDepthDraws = Readonly<
  Record<'opaque' | 'envelope' | 'cutout', GPURenderPipeline>
>;
