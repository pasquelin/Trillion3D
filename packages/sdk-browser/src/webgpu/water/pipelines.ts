import { reflectionLayout } from '../../reflections/gpu.ts';
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

/**
 * Composite pipeline: a fullscreen triangle into the HDR target, blended exactly as the forward
 * transmission pass was — source alpha over what the frame already holds, which at a water pixel is
 * the frozen backdrop itself. A pixel with no water discards, and the target keeps its value.
 */
export async function createWaterCompositePipeline(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  sunWindow?: number,
) {
  const code = waterCompositeShader(sunWindow);
  const module = await createCheckedShaderModule(device, code, 'WATER_COMPOSITE');
  return makeFullscreenPipeline(
    device,
    module,
    [layout, reflectionLayout(device)],
    'composeWater',
    waterCompositeTargets(false),
  );
}

/** The composite's targets: the HDR target, then, when the frame has a share (`asIsShare.ts`), the
 *  reactive value's — green alone, as a particle's. */
export const waterCompositeTargets = (share: boolean): GPUColorTargetState[] => [
  { format: 'rgba16float', blend: ALPHA_BLEND },
  ...(share ? [REACTIVE_TARGET] : []),
];

/** The routed composite's targets: the HDR target as above, then a normal layer's display layers,
 *  then the share. */
export const waterRoutedTargets = (share: boolean): GPUColorTargetState[] => [
  { format: 'rgba16float', blend: ALPHA_BLEND },
  ...displayTargets('normal'),
  ...(share ? [REACTIVE_TARGET] : []),
];

/** An image with no share keeps the composite it had before #833: no reactive target. */
export const WATER_ROUTED_TARGETS: GPUColorTargetState[] = waterRoutedTargets(false);

/**
 * The composite of an image with a share (`asIsShare.ts`), made by the first frame that has one:
 * today's composite plus, as an extra output, the coverage the blend pass and the particles also
 * write — green 1 over what the pixel holds.
 */
function createWaterSharePipeline(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  sunWindow?: number,
) {
  const module = device.createShaderModule({
    label: 'WATER_COMPOSITE',
    code: waterCompositeShader(sunWindow),
  });
  return device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout, reflectionLayout(device)] }),
    vertex: { module, entryPoint: 'fullscreen' },
    fragment: { module, entryPoint: 'composeWaterReactive', targets: waterCompositeTargets(true) },
    primitive: { topology: 'triangle-list' },
  });
}

/** The composite of an image with display layers (`waterRoutedShader`), made by the first one:
 *  the HDR target blended as above, then the tint and the added value of a normal layer; with a
 *  share, the reactive value last. */
function createWaterRoutedPipeline(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  share: boolean,
  sunWindow?: number,
) {
  const code = waterRoutedShader(sunWindow);
  const module = device.createShaderModule({ label: 'WATER_ROUTED', code });
  const bindGroupLayouts = [layout, reflectionLayout(device), displayMaskLayout(device)];
  return device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts }),
    vertex: { module, entryPoint: 'fullscreen' },
    fragment: {
      module,
      entryPoint: share ? 'composeWaterRoutedReactive' : 'composeWaterRouted',
      constants: { DISPLAY_ROUTE: 1 },
      targets: waterRoutedTargets(share),
    },
    primitive: { topology: 'triangle-list' },
  });
}

/**
 * The composite pipelines of one pass, `base` the one made for an image with no share: the plain
 * composite, and, compiled on the first image that asks, the one carrying the reactive value
 * (`asIsShare.ts`), routed through the display layers or not. A scene with no share keeps `base`
 * alone — no extra target, no extra pipeline.
 */
export function createWaterComposites(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  base: GPURenderPipeline,
  sunWindow?: number,
) {
  const made = [base, undefined, undefined, undefined] as (GPURenderPipeline | undefined)[];
  // The display route is the low bit, the share the one above: 0 base, 1 routed, 2 share, 3 both.
  const at = (filtered: boolean, share: boolean) =>
    (made[+filtered + 2 * +share] ??= filtered
      ? createWaterRoutedPipeline(device, layout, share, sunWindow)
      : createWaterSharePipeline(device, layout, sunWindow));
  return { at };
}
