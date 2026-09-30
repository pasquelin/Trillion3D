import { DEPTH_COMPARE } from '../../camera/depthConvention.ts';
import { preparedPipeline } from '../../lighting/deferred/fullscreen.ts';
import {
  SHADOW_TRANSLUCENT_DEPTH_FORMAT,
  SHADOW_TRANSMITTANCE_FORMAT,
  TRANSMITTANCE_BLEND,
} from './transmittance.ts';
import { casterPrimitive } from './casterPrimitive.ts';

/** The layer's own vertex and fragment entries, its label, and group 2 — the pool's depth alone. */
type TransmittanceKind = {
  vertex: string;
  fragment: string;
  name: string;
  own?: GPUBindGroupLayout;
};

/** Group 2 of the layer's draws: the pool's depth at binding 0, which the blended fragments test
 *  against, then `entries`. */
export const transmittanceGroupLayout = (
  device: GPUDevice,
  entries: GPUBindGroupLayoutEntry[] = [],
) =>
  device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
      ...entries,
    ],
  });

/**
 * The two draws of the layer's pass, depth only then colour only, from the same entry points —
 * a page's (`shadow_blend_vs`), or those `kind` names, a moving group's (`groupDraws.ts`):
 * compiled off the frame by `prepare` — at prepare, for a scene whose blended surfaces cast —, or
 * at once by `made`, for a blended caster prepare did not see (`preparedPipeline`). `layouts` are
 * the shadow depth pass's groups 0 and 1; group 2, `opaqueLayout`, is the pool's depth, which the
 * blended fragments test against, and what `kind` binds besides.
 */
export function shadowTransmittanceDraws(
  device: GPUDevice,
  module: GPUShaderModule,
  layouts: GPUBindGroupLayout[],
  kind: TransmittanceKind = {
    vertex: 'shadow_blend_vs',
    fragment: 'shadow_blend_fs',
    name: 'shadow',
  },
) {
  const opaqueLayout = kind.own ?? transmittanceGroupLayout(device);
  const layout = device.createPipelineLayout({ bindGroupLayouts: [...layouts, opaqueLayout] });
  const pipeline = (
    label: string,
    target: GPUColorTargetState,
    depthWriteEnabled: boolean,
    depthCompare: GPUCompareFunction,
  ) =>
    preparedPipeline(device, {
      label,
      layout,
      vertex: { module, entryPoint: kind.vertex },
      fragment: { module, entryPoint: kind.fragment, targets: [target] },
      primitive: casterPrimitive(device, { topology: 'triangle-list', cullMode: 'none' }),
      depthStencil: { format: SHADOW_TRANSLUCENT_DEPTH_FORMAT, depthWriteEnabled, depthCompare },
    });
  const format = SHADOW_TRANSMITTANCE_FORMAT;
  const draws = [
    pipeline(
      `Trillion3D ${kind.name} translucent depth v1`,
      { format, writeMask: 0 },
      true,
      DEPTH_COMPARE,
    ),
    pipeline(
      `Trillion3D ${kind.name} transmittance v1`,
      { format, blend: TRANSMITTANCE_BLEND },
      false,
      'always',
    ),
  ] as const;
  return {
    prepare: () => Promise.all(draws.map((draw) => draw.prepare())),
    made: (): ShadowTransmittanceDraws => ({
      opaqueLayout,
      draws: [draws[0].get(), draws[1].get()],
    }),
  };
}

/** The layer's draws, made (`shadowTransmittanceDraws`). */
export type ShadowTransmittanceDraws = {
  opaqueLayout: GPUBindGroupLayout;
  draws: readonly [GPURenderPipeline, GPURenderPipeline];
};
