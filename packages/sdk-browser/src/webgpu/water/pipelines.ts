import { reflectionLayout } from '../../reflections/layout.ts';
import { DISPLAY_FORMAT, FEEDBACK_FORMAT, SURFACE_FORMATS } from '../../scene/surfaceBuffer.ts';
import { createCheckedShaderModule } from '../../gpu/core/shaderModule.ts';
import { deferredLayoutEntries } from '../../lighting/deferred/setup.ts';
import { makeFullscreenPipeline } from '../../lighting/deferred/fullscreen.ts';
import { readOnly } from '../core/bindLayout.ts';
import { ALPHA_BLEND, blendStagePipelines } from '../blend/stagePipelines.ts';
import { WATER_BINDINGS, waterCompositeShader, waterRoutedShader } from './compositeWgsl.ts';
import { displayMaskLayout, displayTargets } from '../blend/displayFilter.ts';
import { REACTIVE_TARGET } from '../../lighting/deferred/asIsShare.ts';

/** The five targets of the surface stage: the three material surfaces, the water word in the
 *  display colour it borrows, then the virtual-texture feedback. */
const SURFACE_TARGETS: GPUColorTargetState[] = [
  ...SURFACE_FORMATS.slice(0, 3).map((format) => ({ format })),
  { format: DISPLAY_FORMAT },
  { format: FEEDBACK_FORMAT },
];
export const waterSurfaceTargets = (feedback: boolean) =>
  feedback ? SURFACE_TARGETS : SURFACE_TARGETS.slice(0, 4);

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
  feedback = true,
) =>
  blendStagePipelines(
    device,
    module,
    layout,
    {
      module,
      entryPoint: feedback ? 'fsWater' : 'fsWaterWithoutFeedback',
      targets: waterSurfaceTargets(feedback),
    },
    true,
  );

/** Layout of the composite: the deferred bounce layout — the water word, a colour, in the flags'
 *  place —, then what `waterCompositeShader` alone declares. */
export function createWaterCompositeLayout(device: GPUDevice) {
  const b = WATER_BINDINGS,
    fragment = GPUShaderStage.FRAGMENT,
    word: GPUTextureBindingLayout = { sampleType: 'unfilterable-float' };
  return device.createBindGroupLayout({
    label: 'Trillion3D water composite',
    entries: [
      ...deferredLayoutEntries(true, true, readOnly, false).map((entry) =>
        entry.binding === b.word ? { ...entry, texture: word } : entry,
      ),
      { binding: b.backdrop, visibility: fragment, texture: { sampleType: 'unfilterable-float' } },
      { binding: b.backdropDepth, visibility: fragment, texture: { sampleType: 'depth' } },
      { binding: b.uniform, visibility: fragment, buffer: { type: 'uniform' } },
      { binding: b.volumes, visibility: fragment, buffer: readOnly },
    ],
  });
}

/** The composite's targets: the HDR target, then, `routed`, a normal layer's display layers, then,
 *  when the frame has a share (`asIsShare.ts`), the reactive value's — green alone, as a
 *  particle's. */
export const waterCompositeTargets = (share: boolean, routed = false): GPUColorTargetState[] => [
  { format: 'rgba16float', blend: ALPHA_BLEND },
  ...(routed ? displayTargets('normal') : []),
  ...(share ? [REACTIVE_TARGET] : []),
];

/** An image with no share keeps the composite it had before #833: no reactive target. */
export const WATER_ROUTED_TARGETS: GPUColorTargetState[] = waterCompositeTargets(false, true);

/** Each composite's entry point, indexed as `createWaterComposites` caches them. */
const COMPOSE_ENTRIES = [
  'composeWater',
  'composeWaterRouted',
  'composeWaterReactive',
  'composeWaterRoutedReactive',
];

/**
 * The composite pipelines of one pass: a fullscreen triangle into the HDR target, blended exactly
 * as the forward transmission pass was — source alpha over what the frame already holds, which at a
 * water pixel is the frozen backdrop itself; a pixel with no water discards, and the target keeps
 * its value. The plain composite is compiled here; compiled on the first image that asks, the one
 * routed through the display layers (`waterRoutedShader`: the tint and the added value of a
 * normal layer) and the ones carrying the reactive value (`asIsShare.ts`) as a last output. A scene
 * with no share and no display layers keeps the plain one alone — no extra target, no extra pipeline.
 */
export async function createWaterComposites(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  sunWindow?: number,
) {
  const module = await createCheckedShaderModule(
    device,
    waterCompositeShader(sunWindow),
    'WATER_COMPOSITE',
  );
  const layouts = [layout, reflectionLayout(device)];
  const base = await makeFullscreenPipeline(
    device,
    module,
    layouts,
    COMPOSE_ENTRIES[0],
    waterCompositeTargets(false),
  );
  let routedModule: GPUShaderModule | undefined;
  const made: (GPURenderPipeline | undefined)[] = [base, undefined, undefined, undefined];
  const build = (filtered: boolean, share: boolean, entryPoint: string) => {
    const code = filtered
      ? (routedModule ??= device.createShaderModule({
          label: 'WATER_ROUTED',
          code: waterRoutedShader(sunWindow),
        }))
      : module;
    const bindGroupLayouts = filtered ? [...layouts, displayMaskLayout(device)] : layouts;
    return device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts }),
      vertex: { module: code, entryPoint: 'fullscreen' },
      fragment: {
        module: code,
        entryPoint,
        ...(filtered && { constants: { DISPLAY_ROUTE: 1 } }),
        targets: waterCompositeTargets(share, filtered),
      },
      primitive: { topology: 'triangle-list' },
    });
  };
  // The display route is the low bit, the share the one above: 0 base, 1 routed, 2 share, 3 both.
  const at = (filtered: boolean, share: boolean) => {
    const slot = +filtered + 2 * +share;
    return (made[slot] ??= build(filtered, share, COMPOSE_ENTRIES[slot]));
  };
  return { at };
}
