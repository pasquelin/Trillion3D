// Oracle of `stageMapping.ts`, rewritten from its contract: a bound is deposited on its
// stage unless that stage is `null`; a pass is deposited by its label, an unknown label goes
// to "geometry"; a `null` duration leaves its stage unmeasured, a truncated or missing sample
// deposits nothing.
const ETAPE_DE = {
  'WG DAG selection': 'selection',
  'WG partition': 'partition',
  'WG draw compaction': 'selection',
  'WG HiZ pyramid': 'hiZ',
  'WG material surfaces v1': 'geometry',
  'WG shadow atlas v1': 'shadows',
  'WG shadow cull': 'shadows',
  'WG light tiles v1': 'lightLists',
  'WG bounce probes v1': 'bounce',
  'WG bounce surface cache v1': 'bounce',
  'WG deferred lighting': 'lighting',
  'WG HDR composition + present': 'present',
};

export function referenceAddCpuSteps(stages, row, add) {
  for (let i = 0; i < stages.length; i++) if (stages[i]) add(stages[i], row[i]);
}

function totauxParEtape(sample) {
  const totaux = new Map();
  if (!sample || sample.truncated) return totaux;
  for (const pass of sample.passes) {
    const etape = ETAPE_DE[pass.name] ?? 'geometry';
    if (totaux.get(etape) === null) continue;
    totaux.set(etape, pass.gpuMs === null ? null : (totaux.get(etape) ?? 0) + pass.gpuMs);
  }
  return totaux;
}

export function referenceGpuStages(sample, add) {
  for (const [etape, ms] of totauxParEtape(sample)) if (ms !== null) add(etape, ms);
}

export function referenceDirectLightTimings(sample) {
  const totaux = totauxParEtape(sample);
  return {
    gpuLightListsMs: totaux.get('lightLists') ?? null,
    gpuShadowsMs: totaux.get('shadows') ?? null,
    gpuLightingMs: totaux.get('lighting') ?? null,
  };
}
