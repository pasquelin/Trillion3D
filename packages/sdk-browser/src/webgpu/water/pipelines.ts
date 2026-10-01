import { reflectionLayout } from '../../reflections/layout.ts';
import { waterSurfaceTargets } from './surfaceTargets.ts';
import { createCheckedShaderModule } from '../../gpu/core/shaderModule.ts';
import { deferredLayoutEntries } from '../../lighting/deferred/setup.ts';
import { makeFullscreenPipeline } from '../../lighting/deferred/fullscreen.ts';
import { readOnly } from '../core/bindLayout.ts';
import { blendStagePipelines } from '../blend/stagePipelines.ts';
import { WATER_BINDINGS, waterCompositeShader } from './compositeWgsl.ts';
import { waterRoutedShader } from './routedWgsl.ts';
import { displayMaskLayout } from '../blend/displayFilter.ts';
import { waterCompositeTargets } from './compositeTargets.ts';

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
 * normal layer), the ones carrying the reactive value (`asIsShare.ts`) as a last output, and a
 * reference session's, whose mirror ray is unbounded (`waterCompositeShader`). A scene with no
 * share and no display layers keeps the plain one alone — no extra target, no extra pipeline.
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
  // The modules by display route (low bit) and unbounded mirror (the bit above).
  const modules: (GPUShaderModule | undefined)[] = [module];
  const moduleAt = (filtered: boolean, unbounded: boolean) => {
    const label = (filtered ? 'WATER_ROUTED' : 'WATER_COMPOSITE') + (unbounded ? '_UNBOUNDED' : '');
    return (modules[+filtered + 2 * +unbounded] ??= device.createShaderModule({
      label,
      code: filtered
        ? waterRoutedShader(sunWindow, unbounded)
        : waterCompositeShader(sunWindow, unbounded),
    }));
  };
  const made: (GPURenderPipeline | undefined)[] = [base];
  const build = (filtered: boolean, share: boolean, unbounded: boolean, entryPoint: string) => {
    const code = moduleAt(filtered, unbounded);
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
  // The display route is the low bit, the share the one above, the unbounded mirror the third.
  const at = (filtered: boolean, share: boolean, unbounded = false) => {
    const entry = +filtered + 2 * +share;
    return (made[entry + 4 * +unbounded] ??= build(
      filtered,
      share,
      unbounded,
      COMPOSE_ENTRIES[entry],
    ));
  };
  return { at };
}
