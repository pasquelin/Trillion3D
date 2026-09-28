import { DEPTH_COMPARE } from '../../camera/depthConvention.ts';
import { buildRenderPipeline } from '../../lighting/deferred/fullscreen.ts';
import {
  SHADOW_TRANSLUCENT_DEPTH_FORMAT,
  SHADOW_TRANSMITTANCE_FORMAT,
  TRANSMITTANCE_BLEND,
} from './transmittance.ts';

/**
 * The two draws of the layer's pass, each made by `build` — at once, or off the frame at prepare
 * (`buildRenderPipeline`) —: depth only, then colour only, from the same entry points. `layouts`
 * are the shadow depth pass's groups 0 and 1; group 2, `opaqueLayout`, is the pool's depth, which
 * the blended fragments test against.
 */
export function shadowTransmittanceDraws<T>(
  device: GPUDevice,
  module: GPUShaderModule,
  layouts: GPUBindGroupLayout[],
  build: (descriptor: GPURenderPipelineDescriptor) => T,
) {
  const opaqueLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
    ],
  });
  const layout = device.createPipelineLayout({ bindGroupLayouts: [...layouts, opaqueLayout] });
  const pipeline = (
    label: string,
    target: GPUColorTargetState,
    depthWriteEnabled: boolean,
    depthCompare: GPUCompareFunction,
  ) =>
    build({
      label,
      layout,
      vertex: { module, entryPoint: 'shadow_blend_vs' },
      fragment: { module, entryPoint: 'shadow_blend_fs', targets: [target] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: SHADOW_TRANSLUCENT_DEPTH_FORMAT, depthWriteEnabled, depthCompare },
    });
  const format = SHADOW_TRANSMITTANCE_FORMAT;
  return {
    opaqueLayout,
    draws: [
      pipeline(
        'Trillion3D shadow translucent depth v1',
        { format, writeMask: 0 },
        true,
        DEPTH_COMPARE,
      ),
      pipeline(
        'Trillion3D shadow transmittance v1',
        { format, blend: TRANSMITTANCE_BLEND },
        false,
        'always',
      ),
    ] as const,
  };
}

/** The layer's draws, made (`shadowTransmittanceDraws`). */
export type ShadowTransmittanceDraws = {
  opaqueLayout: GPUBindGroupLayout;
  draws: readonly [GPURenderPipeline, GPURenderPipeline];
};

/** The layer's draws for one atlas: compiled off the frame by `prepare` — at prepare, for a scene
 *  whose blended surfaces cast —, or at once by `made`, for a blended caster prepare did not see. */
export function transmittanceDrawsOf(
  device: GPUDevice,
  module: GPUShaderModule,
  layouts: GPUBindGroupLayout[],
) {
  let made: ShadowTransmittanceDraws | undefined;
  return {
    async prepare() {
      if (made) return;
      const { opaqueLayout, draws } = shadowTransmittanceDraws(device, module, layouts, (d) =>
        buildRenderPipeline(device, d),
      );
      const [depth, colour] = await Promise.all(draws);
      made ??= { opaqueLayout, draws: [depth, colour] };
    },
    made: () =>
      (made ??= shadowTransmittanceDraws(device, module, layouts, (d) =>
        device.createRenderPipeline(d),
      )),
  };
}
