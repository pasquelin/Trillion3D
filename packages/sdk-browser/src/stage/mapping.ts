import type { GpuPassTimings } from '../../../sdk-core/src/index.ts';
import { BOUNCE_PROBE_PASS } from '../bounce/probeWgsl.ts';
import { BOUNCE_SURFACE_PASS } from '../bounce/surfaceWgsl.ts';
import { DEFERRED_LIGHTING_PASS } from '../lighting/deferred/deferred.ts';
import { TAA_PASS } from '../taa/shaderWgsl.ts';
import { LIGHT_TILES_PASS } from '../lighting/tiles/tiles.ts';
import { REST_COMPACT_PASS } from '../gpu/raster/restCompact.ts';
import { SHADOW_PASS } from '../gpu/shadow/atlas.ts';
import { SHADOW_LAYER_PASS } from '../gpu/shadow/staticLayer.ts';
import { LIGHT_CUT_PASS } from '../gpu/dag/encode.ts';
import { MATERIAL_DEPTH_PASS, MATERIAL_SURFACES_PASS } from '../webgpu/core/materialPasses.ts';
import type { StageAdd } from './profiler.ts';

/**
 * The two blocks of a frame that can be set against a published profile, and nothing else.
 * `visibility` is building the visibility buffer: selection, partition, Hi-Z and raster.
 * `materials` is writing surfaces from that buffer. Everything else is `other`: shadows, light
 * lists, bounce, transparents, deferred lighting, present, and the fallback path that does not go
 * through the buffer — putting any of those in a block would inflate a comparison instead of
 * serving it, so they stay outside AND named, each pass keeping its duration.
 */
export type GpuPassBlock = 'visibility' | 'materials' | 'other';

/**
 * Profile stage and comparison block of each GPU pass, read from the label the pass already
 * carries. This is the only read of deposit labels: direct-light durations, the per-stage profile
 * and the blocks share it. An unknown label joins `geometry`, the only stage that draws without a
 * name of its own, and `other`, so a new pass does not silently swell a compared block.
 */
const PASSES: Readonly<Record<string, readonly [stage: string, block: GpuPassBlock]>> =
  Object.freeze({
    'WG DAG selection': ['selection', 'visibility'],
    'WG partition': ['partition', 'visibility'],
    'WG draw compaction': ['selection', 'visibility'],
    [REST_COMPACT_PASS]: ['geometry', 'other'],
    'WG HiZ pyramid': ['hiZ', 'visibility'],
    'WG HiZ test': ['hiZ', 'visibility'],
    'WG clear': ['geometry', 'visibility'],
    'WG visibility primary': ['geometry', 'visibility'],
    'WG visibility secondary': ['geometry', 'visibility'],
    'WG small triangle binning': ['geometry', 'visibility'],
    'WG small triangle raster': ['geometry', 'visibility'],
    'WG hybrid visibility resolve': ['geometry', 'visibility'],
    // Compute raster (`../gpu/raster/raster.ts`, `../gpu/raster/resolve.ts`): it builds the same buffer.
    'WG raster target and lists': ['geometry', 'visibility'],
    'WG raster dispatch': ['geometry', 'visibility'],
    'WG raster binning': ['geometry', 'visibility'],
    'WG raster occluder depth': ['geometry', 'visibility'],
    'WG raster tested depth': ['geometry', 'visibility'],
    'WG raster identifiers': ['geometry', 'visibility'],
    'WG raster occluder hiz': ['hiZ', 'visibility'],
    'WG raster resolve': ['geometry', 'visibility'],
    'WG empty surfaces': ['geometry', 'materials'],
    [MATERIAL_DEPTH_PASS]: ['geometry', 'materials'],
    [MATERIAL_SURFACES_PASS]: ['geometry', 'materials'],
    'WG opaque fallback': ['geometry', 'other'],
    'WG transparents': ['transparents', 'other'],
    'WG transmission': ['transparents', 'other'],
    'WG water surfaces': ['transparents', 'other'],
    'WG water composite': ['transparents', 'other'],
    'WG transparent compaction': ['transparents', 'other'],
    [SHADOW_PASS]: ['shadows', 'other'],
    [SHADOW_LAYER_PASS]: ['shadows', 'other'],
    [LIGHT_CUT_PASS]: ['shadowCasters', 'other'],
    'WG shadow cull': ['shadows', 'other'],
    'WG shadow page pyramids': ['shadows', 'other'],
    'WG shadow occlusion': ['shadows', 'other'],
    [LIGHT_TILES_PASS]: ['lightLists', 'other'],
    [BOUNCE_SURFACE_PASS]: ['bounce', 'other'],
    [BOUNCE_PROBE_PASS]: ['bounce', 'other'],
    [DEFERRED_LIGHTING_PASS]: ['lighting', 'other'],
    [TAA_PASS]: ['antialiasing', 'other'],
    'WG HDR composition': ['present', 'other'],
    'WG HDR composition + present': ['present', 'other'],
    'WG direct present': ['present', 'other'],
    'WG explicit capture': ['present', 'other'],
  });

/** Stage of a pass, by its label. Unknown is `geometry`. */
export const gpuPassStageOf = (name: string) => PASSES[name]?.[0] ?? 'geometry';
/** Block of a pass, by its label. Unknown is `other`. */
export const gpuPassBlockOf = (name: string): GpuPassBlock => PASSES[name]?.[1] ?? 'other';

/** Stages the WebGPU engine can name, in the order they occur. */
export const WEBGPU_STAGES = [
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

/** The three direct-lighting durations of the frame, read from the same sample by label. */
export function directLightTimings(sample: GpuPassTimings | null | undefined) {
  const totals = gpuStageTotals(sample);
  return {
    gpuLightListsMs: totals.get('lightLists') ?? null,
    gpuShadowsMs: totals.get('shadows') ?? null,
    gpuLightingMs: totals.get('lighting') ?? null,
  };
}
