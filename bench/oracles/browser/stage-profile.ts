// Oracle of `packages/sdk-browser/src/stage/mapping.ts`, rewritten from its contract: a bound is deposited on its
// stage unless that stage is `null`; a pass is deposited by its label, an unknown label goes
// to "geometry"; a `null` duration leaves its stage unmeasured, a truncated or missing sample
// deposits nothing. Shadow time also splits by label into choosing the casters and drawing them.
import type { GpuPassTimings } from '../../../packages/sdk-core/src/index.ts';
import type { StageAdd } from '../../../packages/sdk-browser/src/stage/profiler.ts';

const ETAPE_DE: Record<string, string> = {
  'Trillion3D DAG selection': 'selection',
  'Trillion3D partition': 'partition',
  'Trillion3D draw compaction': 'selection',
  'Trillion3D HiZ pyramid': 'hiZ',
  'Trillion3D material surfaces v1': 'geometry',
  'Trillion3D shadow atlas v1': 'shadows',
  'Trillion3D shadow static layer v1': 'shadows',
  'Trillion3D shadow cull': 'shadows',
  'Trillion3D shadow page pyramids': 'shadows',
  'Trillion3D shadow occlusion': 'shadows',
  'Trillion3D light cut': 'shadowCasters',
  'Trillion3D light tiles v1': 'lightLists',
  'Trillion3D bounce probes v1': 'bounce',
  'Trillion3D bounce surface cache v1': 'bounce',
  'Trillion3D deferred lighting': 'lighting',
  'Trillion3D HDR composition + present': 'present',
};

const PART_DE: Record<string, string> = {
  'Trillion3D light cut': 'cull',
  'Trillion3D shadow cull': 'cull',
  'Trillion3D shadow page pyramids': 'cull',
  'Trillion3D shadow occlusion': 'cull',
  'Trillion3D shadow static layer v1': 'raster',
  'Trillion3D shadow atlas v1': 'raster',
};

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
  groupes: Record<string, string>,
  sinon: string,
): Map<string, number | null> {
  const totaux = new Map<string, number | null>();
  if (!sample || sample.truncated) return totaux;
  for (const pass of sample.passes) {
    const etape = groupes[pass.name] ?? sinon;
    if (totaux.get(etape) === null) continue;
    totaux.set(etape, pass.gpuMs === null ? null : (totaux.get(etape) ?? 0) + pass.gpuMs);
  }
  return totaux;
}

export function referenceGpuStages(sample: GpuPassTimings | null | undefined, add: StageAdd) {
  for (const [etape, ms] of totauxPar(sample, ETAPE_DE, 'geometry'))
    if (ms !== null) add(etape, ms);
}

export function referenceDirectLightTimings(sample: GpuPassTimings | null | undefined) {
  const totaux = totauxPar(sample, ETAPE_DE, 'geometry'),
    parts = totauxPar(sample, PART_DE, 'other');
  return {
    gpuLightListsMs: totaux.get('lightLists') ?? null,
    gpuShadowsMs: totaux.get('shadows') ?? null,
    gpuShadowCullMs: parts.get('cull') ?? null,
    gpuShadowRasterMs: parts.get('raster') ?? null,
    gpuLightingMs: totaux.get('lighting') ?? null,
  };
}
