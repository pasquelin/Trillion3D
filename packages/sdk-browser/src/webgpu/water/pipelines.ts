import { FEEDBACK_FORMAT, SURFACE_FORMATS } from '../../scene/surfaceBuffer.ts';
import { createCheckedShaderModule } from '../../gpu/core/shaderModule.ts';
import { deferredLayoutEntries } from '../../lighting/deferred/setup.ts';
import { makeFullscreenPipeline } from '../../lighting/deferred/program.ts';
import { readOnly } from '../core/bindLayout.ts';
import { ALPHA_BLEND, blendStagePipelines } from '../blend/stagePipelines.ts';
import { WATER_BINDINGS, WATER_COMPOSITE_SHADER } from './compositeWgsl.ts';

/** The five targets of the surface stage: the surface buffer, then the virtual-texture feedback. */
const SURFACE_TARGETS: GPUColorTargetState[] = [
  ...SURFACE_FORMATS.map((format) => ({ format })),
  { format: FEEDBACK_FORMAT },
];

/**
 * Surface stage: the blend module's vertex stage and `fsWater`, on the blend bind group layout —
 * nothing else is bound for it. Depth is tested AND written, against the opaque depth copied in:
 * the nearest surface of a pixel is the one the composite lights, and a surface behind an opaque
 * never reaches it. No blend: the targets carry material values, not colour.
 */
export const createWaterSurfacePipelines = (
  device: GPUDevice,
  module: GPUShaderModule,
  layout: GPUBindGroupLayout,
) =>
  blendStagePipelines(
    device,
    module,
    layout,
    { module, entryPoint: 'fsWater', targets: SURFACE_TARGETS },
    true,
  );

/** Layout of the composite: the deferred bounce layout, then what `WATER_COMPOSITE_SHADER` alone
 *  declares. */
export function createWaterCompositeLayout(device: GPUDevice) {
  const b = WATER_BINDINGS,
    fragment = GPUShaderStage.FRAGMENT;
  return device.createBindGroupLayout({
    label: 'WG water composite',
    entries: [
      ...deferredLayoutEntries(true, true, readOnly),
      { binding: b.backdrop, visibility: fragment, texture: { sampleType: 'unfilterable-float' } },
      { binding: b.backdropDepth, visibility: fragment, texture: { sampleType: 'depth' } },
      { binding: b.uniform, visibility: fragment, buffer: { type: 'uniform' } },
      { binding: b.volumes, visibility: fragment, buffer: readOnly },
    ],
  });
}

/**
 * Composite pipeline: a fullscreen triangle into the HDR target, blended exactly as the forward
 * transmission pass was — source alpha over what the frame already holds, which at a water pixel is
 * the frozen backdrop itself. A pixel with no water discards, and the target keeps its value.
 */
export async function createWaterCompositePipeline(device: GPUDevice, layout: GPUBindGroupLayout) {
  const module = await createCheckedShaderModule(device, WATER_COMPOSITE_SHADER, 'WATER_COMPOSITE');
  return makeFullscreenPipeline(device, module, layout, 'composeWater', [
    { format: 'rgba16float', blend: ALPHA_BLEND },
  ]);
}
