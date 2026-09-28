import { SHADOW_ARRAY } from '../../gpu/shadow/layers.ts';
import { BLEND_SHADER } from './shader.ts';
import { FEEDBACK_FORMAT } from '../../scene/surfaceBuffer.ts';
import { BLEND_VIEW_SIZE } from './uniforms.ts';
import type { BlendGpuItem } from './state.ts';
import { BLEND_BINDINGS, atlasLayoutEntries, readOnly } from '../core/bindLayout.ts';
import { WATER_SURFACE_WGSL } from '../water/surfaceWgsl.ts';
import {
  declaredBlendModes,
  pipelinesByMode,
  stageDescriptors,
  type BlendModePipelines,
} from './stagePipelines.ts';
import type { Blending } from '../../../../sdk-core/src/world/constants/index.ts';
import { BLEND_EQUATIONS, BLEND_MODES } from '../../scene/materialBlending.ts';
import { createWaterPass, type WaterPass } from '../water/pass.ts';
import {
  blendVariantPipeline,
  DIAGNOSTIC_BLEND_WGSL,
  type DiagnosticGpuVariant,
} from '../../diagnostic/gpuVariant.ts';
import { feedbackFreeEntry } from '../tile/feedbackAbWgsl.ts';
export const blendTargets = (
  mode: Blending,
  mask: GPUColorWriteFlags,
  feedback: boolean,
): GPUColorTargetState[] => [
  { format: 'rgba16float', writeMask: mask, blend: BLEND_EQUATIONS[mode] },
  ...(feedback ? [{ format: FEEDBACK_FORMAT }] : []),
];

/** Builds the forward-material pipelines for transparent draws, and the water pass of a scene
 *  that transmits. */
export async function createWebgpuBlendPipelines(
  device: GPUDevice,
  items: BlendGpuItem[],
  variant?: DiagnosticGpuVariant,
  feedback = true,
  sharedLayout?: GPUBindGroupLayout,
) {
  const b = BLEND_BINDINGS;
  // Without a variant, the module and the targets are exactly those of before: production compiles
  // no diagnostic stage and has no write mask of its own.
  const selected = blendVariantPipeline(variant);
  const entryPoint = feedback ? selected.entryPoint : 'fsWithoutFeedback';
  const { writeMask } = selected;
  const blendBindGroupLayout =
    sharedLayout ??
    device.createBindGroupLayout({
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
        // Resident proxy of the far sun shadow: **read-only**, and that is the condition of early
        // depth rejection for the whole pass. A binding writable from the fragment stage forces the
        // GPU to shade every fragment before testing it, side effect and all — here 4232 fragment
        // draws fully hidden behind opaque. The shadow ray is the same; only the two census counters
        // stay with deferred resolve, which can write. The surface cache below takes the eighth
        // and last storage binding the spec guarantees for this fragment stage.
        { binding: b.proxy, visibility: GPUShaderStage.FRAGMENT, buffer: readOnly },
        { binding: b.surfaceCache, visibility: GPUShaderStage.FRAGMENT, buffer: readOnly },
      ],
    });
  // The water pass exists for a scene that transmits, outside any diagnostic variant: under one,
  // the transmission slice draws as one more blend, so the variant measures the same fragment
  // stage on all of it. Its surface stage is compiled into the blend module only then.
  const wantsWater = !variant && items.some((item) => item.transmissive);
  let code =
    BLEND_SHADER + (wantsWater ? WATER_SURFACE_WGSL : '') + (variant ? DIAGNOSTIC_BLEND_WGSL : '');
  if (!feedback) {
    code = feedbackFreeEntry(
      code,
      'fs',
      'BlendOut',
      [['color', 'vec4f']],
      'in:VSOut,@builtin(front_facing) front:bool',
      'in,front',
    );
    if (wantsWater)
      code = feedbackFreeEntry(
        code,
        'fsWater',
        'WaterOut',
        [
          ['baseMetal', 'vec4f'],
          ['normalRough', 'vec4f'],
          ['emissiveAo', 'vec4f'],
          ['word', 'vec4f'],
        ],
        'in:VSOut,@builtin(front_facing) front:bool',
        'in,front',
      );
  }
  const blendModule = device.createShaderModule({ code: code });
  const fragment = (mode: Blending): GPUFragmentState => ({
    module: blendModule,
    entryPoint,
    targets: blendTargets(mode, writeMask, feedback),
  });
  const perMode = pipelinesByMode(device, (mode) =>
    stageDescriptors(device, blendModule, blendBindGroupLayout, fragment(mode), false),
  );
  // Normal always — the transmission slice draws on it under a diagnostic —, then every mode a
  // blend item declares. A mode written on a surface later is compiled by the first draw that
  // asks for it (`at`).
  await perMode.precompile(declaredBlendModes(items));
  const blendPipelines: BlendModePipelines = {
    byMode: perMode.byMode,
    at(rank) {
      const mode = BLEND_MODES[Math.floor(rank / 3)];
      if (!mode) throw new Error(`blend pipeline rank ${rank} names no blending mode`);
      return perMode.at(mode)[rank % 3];
    },
  };
  // A device that refuses the pass keeps the blends, and `waterRefused` names why to the caller.
  let water: WaterPass | undefined, waterRefused: Error | undefined;
  if (wantsWater)
    try {
      water = await createWaterPass(device, blendModule, blendBindGroupLayout, feedback);
    } catch (error) {
      waterRefused = error instanceof Error ? error : new Error(String(error));
    }
  return {
    blendBindGroupLayout,
    blendPipelines,
    water,
    waterRefused,
  };
}
