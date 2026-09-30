import type { GpuPassTimings } from '../../../sdk-core/src/index.ts';
import type { StageAdd } from './profiler.ts';
import { type GpuPassBlock, PASSES, gpuShadowPartOf } from './passTable.ts';

export type { GpuPassBlock } from './passTable.ts';

/** Stage of a pass, by its label. Unknown is `geometry`. */
export const gpuPassStageOf = (name: string) => PASSES[name]?.[0] ?? 'geometry';
/** Block of a pass, by its label. Unknown is `other`. */
export const gpuPassBlockOf = (name: string): GpuPassBlock => PASSES[name]?.[1] ?? 'other';

/** Stages the WebGPU engine can name, in the order they occur. */
export const WEBGPU_STAGES = [
  'physics',
  'animations',
  'lights',
  'cutAdoption',
  'selection',
  'transparents',
  'residency',
  'hostPages',
  'uploads',
  'textures',
  'partition',
  'encode',
  'submit',
  'hiZ',
  'geometry',
  'coplanar',
  'shadows',
  'shadowCasters',
  'sunFarShadows',
  'lightLists',
  'bounce',
  'lighting',
  'antialiasing',
  'present',
] as const;

/** Stages the WebGL2 engine can name. */
export const WEBGL_STAGES = [
  'physics',
  'animations',
  'lights',
  'hierarchyCut',
  'selection',
  'uploads',
  'residency',
  'submit',
  'frame',
] as const;

/**
 * GPU duration of a sample by pass group, in one walk, `classify` naming each pass's
 * group. `null` for a group whose one pass has no usable duration: a partial sum would
 * pass for a measurement. A truncated or missing sample yields no group, for the same reason.
 */
export function gpuTotalsBy<Group extends string>(
  sample: GpuPassTimings | null | undefined,
  classify: (name: string) => Group,
) {
  const totals = new Map<Group, number | null>();
  if (!sample || sample.truncated) return totals;
  for (const pass of sample.passes) {
    const group = classify(pass.name);
    const total = totals.get(group);
    if (total === null) continue;
    totals.set(group, pass.gpuMs === null ? null : (total ?? 0) + pass.gpuMs);
  }
  return totals;
}

/** GPU duration of each profile stage. */
const gpuStageTotals = (sample: GpuPassTimings | null | undefined) =>
  gpuTotalsBy(sample, gpuPassStageOf);

/** Split a sample onto profile stages: what is not measured is not deposited. */
export function addGpuPasses(sample: GpuPassTimings | null | undefined, add: StageAdd) {
  for (const [stage, ms] of gpuStageTotals(sample)) if (ms !== null) add(stage, ms);
}

/**
 * GPU duration of a sample's "Bounce" stage, or `null`: that is the measurement the
 * millisecond budget servos. A missing stage, a truncated sample or a device without
 * timestamps yield `null`, and the servo does not move rather than follow a zero.
 */
export function bounceGpuMs(sample: GpuPassTimings | null | undefined) {
  return gpuStageTotals(sample).get('bounce') ?? null;
}

/** The direct-lighting durations of the frame, read from the same sample by label. */
export function directLightTimings(sample: GpuPassTimings | null | undefined) {
  const totals = gpuStageTotals(sample),
    parts = gpuTotalsBy(sample, gpuShadowPartOf);
  return {
    gpuLightListsMs: totals.get('lightLists') ?? null,
    gpuShadowsMs: totals.get('shadows') ?? null,
    gpuShadowCullMs: parts.get('cull') ?? null,
    gpuShadowRasterMs: parts.get('raster') ?? null,
    gpuLightingMs: totals.get('lighting') ?? null,
  };
}
