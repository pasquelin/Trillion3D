// Oracle of `packages/sdk-browser/src/stage/mapping.ts`, rewritten from its contract: a bound is deposited on its
// stage unless that stage is `null`; a pass is deposited by its label, an unknown label goes
// to "geometry"; a `null` duration leaves its stage unmeasured, a truncated or missing sample
// deposits nothing. Shadow time also splits by label into choosing the casters and drawing them.
import type { GpuPassTimings } from '../../../packages/sdk-core/src/index.ts';
import type { StageAdd } from '../../../packages/sdk-browser/src/stage/profiler.ts';

// Stage of each label, then its shadow part: choosing the casters or drawing them.
const ROW_OF: Record<string, readonly [stage: string, part?: string]> = {
  'Trillion3D DAG selection': ['selection'],
  'Trillion3D partition': ['partition'],
  'Trillion3D draw compaction': ['selection'],
  'Trillion3D HiZ pyramid': ['hiZ'],
  'Trillion3D material surfaces v1': ['geometry'],
  'Trillion3D shadow atlas v1': ['shadows', 'raster'],
  'Trillion3D shadow static layer v1': ['shadows', 'raster'],
  'Trillion3D shadow cull': ['shadows', 'cull'],
  'Trillion3D shadow page pyramids': ['shadows', 'cull'],
  'Trillion3D shadow occlusion': ['shadows', 'cull'],
  'Trillion3D light cut': ['shadowCasters', 'cull'],
  'Trillion3D light tiles v1': ['lightLists'],
  'Trillion3D bounce probes v1': ['bounce'],
  'Trillion3D bounce surface cache v1': ['bounce'],
  'Trillion3D deferred lighting': ['lighting'],
  'Trillion3D HDR composition + present': ['present'],
};

const stageOf = (name: string) => ROW_OF[name]?.[0] ?? 'geometry';
const partOf = (name: string) => ROW_OF[name]?.[1] ?? 'other';

export function referenceAddCpuSteps(
  stages: ReadonlyArray<string | null>,
  row: ArrayLike<number>,
  add: StageAdd,
) {
  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i];
    if (stage) add(stage, row[i]);
  }
}

function totauxPar(
  sample: GpuPassTimings | null | undefined,
  groupOf: (name: string) => string,
): Map<string, number | null> {
  const totaux = new Map<string, number | null>();
  if (!sample || sample.truncated) return totaux;
  for (const pass of sample.passes) {
    const etape = groupOf(pass.name);
    if (totaux.get(etape) === null) continue;
    totaux.set(etape, pass.gpuMs === null ? null : (totaux.get(etape) ?? 0) + pass.gpuMs);
  }
  return totaux;
}

export function referenceGpuStages(sample: GpuPassTimings | null | undefined, add: StageAdd) {
  for (const [etape, ms] of totauxPar(sample, stageOf)) if (ms !== null) add(etape, ms);
}

export function referenceDirectLightTimings(sample: GpuPassTimings | null | undefined) {
  const totaux = totauxPar(sample, stageOf),
    parts = totauxPar(sample, partOf);
  return {
    gpuLightListsMs: totaux.get('lightLists') ?? null,
    gpuShadowsMs: totaux.get('shadows') ?? null,
    gpuShadowCullMs: parts.get('cull') ?? null,
    gpuShadowRasterMs: parts.get('raster') ?? null,
    gpuLightingMs: totaux.get('lighting') ?? null,
  };
}
