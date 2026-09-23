// Oracle of `packages/sdk-browser/src/stage/mapping.ts`, rewritten from its contract: a bound is deposited on its
// stage unless that stage is `null`; a pass is deposited by its label, an unknown label goes
// to "geometry"; a `null` duration leaves its stage unmeasured, a truncated or missing sample
// deposits nothing.
import type { GpuPassTimings } from '../../../packages/sdk-core/src/index.ts';
import type { StageAdd } from '../../../packages/sdk-browser/src/stage/profiler.ts';

const ETAPE_DE: Record<string, string> = {
  'Trillion3D DAG selection': 'selection',
  'Trillion3D partition': 'partition',
  'Trillion3D draw compaction': 'selection',
  'Trillion3D HiZ pyramid': 'hiZ',
  'Trillion3D material surfaces v1': 'geometry',
  'Trillion3D shadow atlas v1': 'shadows',
  'Trillion3D shadow cull': 'shadows',
  'Trillion3D light tiles v1': 'lightLists',
  'Trillion3D bounce probes v1': 'bounce',
  'Trillion3D bounce surface cache v1': 'bounce',
  'Trillion3D deferred lighting': 'lighting',
  'Trillion3D HDR composition + present': 'present',
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

function totauxParEtape(sample: GpuPassTimings | null | undefined): Map<string, number | null> {
  const totaux = new Map<string, number | null>();
  if (!sample || sample.truncated) return totaux;
  for (const pass of sample.passes) {
    const etape = ETAPE_DE[pass.name] ?? 'geometry';
    if (totaux.get(etape) === null) continue;
    totaux.set(etape, pass.gpuMs === null ? null : (totaux.get(etape) ?? 0) + pass.gpuMs);
  }
  return totaux;
}

export function referenceGpuStages(sample: GpuPassTimings | null | undefined, add: StageAdd) {
  for (const [etape, ms] of totauxParEtape(sample)) if (ms !== null) add(etape, ms);
}

export function referenceDirectLightTimings(sample: GpuPassTimings | null | undefined) {
  const totaux = totauxParEtape(sample);
  return {
    gpuLightListsMs: totaux.get('lightLists') ?? null,
    gpuShadowsMs: totaux.get('shadows') ?? null,
    gpuLightingMs: totaux.get('lighting') ?? null,
  };
}
