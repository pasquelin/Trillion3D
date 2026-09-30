import { SHADOW_ARRAY } from '../../gpu/shadow/layers.ts';
import { blendShader } from './shader.ts';
import { FEEDBACK_FORMAT } from '../../scene/surfaceBuffer.ts';
import { BLEND_VIEW_SIZE } from './uniforms.ts';
import type { BlendGpuItem } from './state.ts';
import { BLEND_BINDINGS, atlasLayoutEntries, readOnly } from '../core/bindLayout.ts';
import {
  declaredBlendModes,
  pipelinesByMode,
  stageDescriptors,
  type BlendModePipelines,
} from './stagePipelines.ts';
import type { Blending } from '../../../../sdk-core/src/world/constants/index.ts';
import { BLEND_MODES } from '../../scene/materialBlending.ts';
import { COVERAGE_EQUATIONS, filtersDisplay } from './equations.ts';
import { displayTargets } from './displayFilter.ts';
import { SHARE_TARGET } from '../../lighting/deferred/asIsShare.ts';
import { createRoutedPipelines } from './routedPipelines.ts';
import type { WaterPass } from '../water/waterPass.ts';
import { fluidCode } from '../../fluids/particleCode.ts';
import {
  blendVariantPipeline,
  DIAGNOSTIC_BLEND_WGSL,
  type DiagnosticGpuVariant,
} from '../../diagnostic/gpuVariant.ts';
import { feedbackFreeEntry } from '../tile/feedbackAbWgsl.ts';
/** The pass's targets in `mode`; `filtered`, with the display layers (`displayFilter.ts`); `share`,
 *  with the share a debug view or the temporal pass reads (`asIsShare.ts`), else an empty slot. */
export const blendTargets = (
  mode: Blending,
  mask: GPUColorWriteFlags,
  feedback: boolean,
  filtered = false,
  share = true,
): (GPUColorTargetState | null)[] => [
  // A filtering mode of a filtered image leaves the lit target to the display layers.
  {
    format: 'rgba16float',
    writeMask: filtered && filtersDisplay(mode) ? 0 : mask,
    blend: COVERAGE_EQUATIONS[mode],
  },
  ...(feedback ? [{ format: FEEDBACK_FORMAT }] : []),
  share ? SHARE_TARGET : null, // every mode covers it at its alpha (#365), green included (#833)
  ...(filtered ? displayTargets(mode) : []),
];
/** The blend fragment's values, in their order: what a feedback-free entry keeps. */
const BLEND_OUT: [string, string][] = ['color', 'asIs', 'tint', 'add'].map((name) => [
  name,
  'vec4f',
]);
const FRAGMENT_IN = ['in:VSOut,@builtin(front_facing) front:bool', 'in,front'] as const;

/** The forward materials' bind layout, which the feedback-free diagnostic pipelines share. */
function blendLayout(device: GPUDevice) {
  const b = BLEND_BINDINGS;
  return device.createBindGroupLayout({
    entries: [
      { binding: b.indices, visibility: GPUShaderStage.VERTEX, buffer: readOnly },
      { binding: b.positions, visibility: GPUShaderStage.VERTEX, buffer: readOnly },
      { binding: b.uvs, visibility: GPUShaderStage.VERTEX, buffer: readOnly },
      {
        binding: b.uniform,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform', minBindingSize: BLEND_VIEW_SIZE },
      },
      // Each item's record, read at the rank the vertex index carries: it is what replaces the
      // dynamic uniform offset, and therefore the bind group per draw.
      { binding: b.items, visibility: GPUShaderStage.VERTEX, buffer: readOnly },
      ...atlasLayoutEntries(b.color),
      { binding: b.sampler, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      ...atlasLayoutEntries(b.data),
      { binding: b.normals, visibility: GPUShaderStage.VERTEX, buffer: readOnly },
      { binding: b.directLights, visibility: GPUShaderStage.FRAGMENT, buffer: readOnly },
      { binding: b.clusterDiagnostic, visibility: GPUShaderStage.VERTEX, buffer: readOnly },
      { binding: b.planInstances, visibility: GPUShaderStage.VERTEX, buffer: readOnly },
      { binding: b.clusterSpans, visibility: GPUShaderStage.VERTEX, buffer: readOnly },
      { binding: b.shadowData, visibility: GPUShaderStage.FRAGMENT, buffer: readOnly },
      {
        binding: b.shadowAtlas,
        visibility: GPUShaderStage.FRAGMENT,
        texture: SHADOW_ARRAY,
      },
      {
        binding: b.shadowSampler,
        visibility: GPUShaderStage.FRAGMENT,
        sampler: { type: 'comparison' },
      },
      {
        binding: b.shadowTransmittance,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'unfilterable-float', viewDimension: '2d-array' },
      },
      {
        binding: b.shadowTranslucentDepth,
        visibility: GPUShaderStage.FRAGMENT,
        texture: SHADOW_ARRAY,
      },
      { binding: b.bounceGrid, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: b.probes, visibility: GPUShaderStage.FRAGMENT, buffer: readOnly },
      { binding: b.tileLights, visibility: GPUShaderStage.FRAGMENT, buffer: readOnly },
      // The far sun shadow's proxy, **read-only**: a binding the fragment stage could write would
      // cost the pass its early depth reject (4232 hidden fragment draws). The surface cache takes
      // the eighth and last storage binding the spec guarantees for this fragment stage.
      { binding: b.proxy, visibility: GPUShaderStage.FRAGMENT, buffer: readOnly },
      { binding: b.surfaceCache, visibility: GPUShaderStage.FRAGMENT, buffer: readOnly },
    ],
  });
}

/** Builds the forward-material pipelines for transparent draws, and the water pass of a scene
 *  that transmits; both read the shadows of the session's sun window (`sunWindow`). */
export async function createWebgpuBlendPipelines(
  device: GPUDevice,
  items: BlendGpuItem[],
  variant?: DiagnosticGpuVariant,
  feedback = true,
  sharedLayout?: GPUBindGroupLayout,
  share = false,
  sunWindow?: number,
) {
  // Without a variant, production compiles no diagnostic stage and has no write mask of its own.
  const selected = blendVariantPipeline(variant);
  const entryPoint = feedback ? selected.entryPoint : 'fsWithoutFeedback';
  const { writeMask } = selected;
  const blendBindGroupLayout = sharedLayout ?? blendLayout(device);
  // The water pass exists for a scene that transmits, outside any diagnostic variant: under one,
  // the transmission slice draws as one more blend, the same fragment stage measured on all.
  const wantsWater = !variant && items.some((item) => item.transmissive);
  // Its code, the fluids', is imported by the first scene that does, as a texture loads: the
  // prepare awaits it, no frame does (#1353). A refused import, as a refused pass, keeps the
  // blends and says why.
  const waterCode = wantsWater
    ? (fluidCode.get() ?? (await fluidCode.settled(), fluidCode.get()))
    : undefined;
  let waterRefused = wantsWater ? fluidCode.failed : undefined;
  let code =
    blendShader(sunWindow) +
    (waterCode?.WATER_SURFACE_WGSL ?? '') +
    (variant ? DIAGNOSTIC_BLEND_WGSL : '');
  if (!feedback) {
    for (const entry of ['fs', 'fsFiltered'])
      code = feedbackFreeEntry(code, entry, 'BlendOut', BLEND_OUT, ...FRAGMENT_IN);
    if (waterCode) code = waterCode.waterWithoutFeedback(code);
  }
  const blendModule = device.createShaderModule({ code: code });
  // Two lazy sets (#365): with no reader of the share its slot stays empty, no target is bound.
  const sets = [false, true].map((withShare) => ({
    perMode: pipelinesByMode(device, (mode) =>
      stageDescriptors(
        device,
        blendModule,
        blendBindGroupLayout,
        {
          module: blendModule,
          entryPoint,
          targets: blendTargets(mode, writeMask, feedback, false, withShare),
        },
        false,
      ),
    ),
    routed: createRoutedPipelines(device, blendModule, blendBindGroupLayout, feedback, (mode) =>
      blendTargets(mode, writeMask, feedback, true, withShare),
    ),
  }));
  // Normal with any item (the transmission slice draws on it under a diagnostic), every mode an item
  // declares, filtered too when one filters, in the set drawn now; the rest compiles at `at`. No
  // item, no blend program (#1362).
  const declared = declaredBlendModes(items),
    { perMode, routed } = sets[+share];
  await Promise.all([
    perMode.precompile(declared),
    !variant && declared.some(filtersDisplay) && routed.precompile(declared),
  ]);
  const blendPipelines: BlendModePipelines = {
    byMode: perMode.byMode,
    mask: routed.mask,
    at(rank, filtered = false, withShare = false) {
      const mode = BLEND_MODES[Math.floor(rank / 3)];
      if (!mode) throw new Error(`blend pipeline rank ${rank} names no blending mode`);
      const set = sets[+withShare];
      return (filtered ? set.routed.filtered : set.perMode).at(mode)[rank % 3];
    },
  };
  // A device that refuses the pass keeps the blends, and `waterRefused` names why to the caller.
  const water: WaterPass | undefined = await waterCode
    ?.createWaterPass(device, blendModule, blendBindGroupLayout, feedback, sunWindow)
    .catch((error: unknown) => {
      waterRefused = error instanceof Error ? error : new Error(String(error));
      return undefined;
    });
  return { blendBindGroupLayout, blendPipelines, water, waterRefused };
}
