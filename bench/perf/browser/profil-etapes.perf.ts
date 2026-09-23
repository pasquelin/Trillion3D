// per-stage profile breakdown, done every frame: CPU bounds deposited on their
// stages, and GPU passes read by their label.
import type { GpuPassTimings } from '../../../packages/sdk-core/src/index.ts';
import { addCpuSteps } from '../../../packages/sdk-browser/stageCpuSteps.ts';
import { addGpuPasses, directLightTimings } from '../../../packages/sdk-browser/stageMapping.ts';
import type { StageAdd } from '../../../packages/sdk-browser/stageProfiler.ts';
import {
  CPU_STEP_NAMES,
  CPU_STEP_STAGES,
} from '../../../packages/sdk-browser/webgpuPagesCpuSteps.ts';
import { graine, mesure, stress, rapport } from '../../core/index.ts';
import {
  referenceAddCpuSteps,
  referenceDirectLightTimings,
  referenceGpuStages,
} from '../../oracles/browser/profil-etapes.ts';

const alea = graine(113);

const NB_BORNES = CPU_STEP_NAMES.length;

const lignes = (images: number): Float64Array[] =>
  Array.from({ length: images }, () => Float64Array.from({ length: NB_BORNES }, () => alea() * 10));

const depose =
  <Row>(ventile: (row: Row, add: StageAdd) => void) =>
  (rows: Row[]) => {
    const total = new Map<string, number>();
    const add: StageAdd = (stage, ms) => total.set(stage, (total.get(stage) ?? 0) + ms);
    for (const row of rows) ventile(row, add);
    return total;
  };

const mesureCpu = await mesure({
  name: 'CPU bounds per stage',
  fichier: 'packages/sdk-browser/stageCpuSteps.ts',
  cas: [
    { name: `${NB_BORNES} bounds × 200 frames`, input: lignes(200), size: 200 * NB_BORNES },
    { name: 'no frames', input: [], size: 0 },
  ],
  calcul: depose((row, add) => addCpuSteps(CPU_STEP_STAGES, row, add)),
  attendu: depose((row, add) => referenceAddCpuSteps(CPU_STEP_STAGES, row, add)),
});

// A sample carries known passes, one unknown pass — which joins "geometry" — and, once
// in ten, a `null` duration that leaves its stage unmeasured.
const ETIQUETTES = [
  'WG DAG selection',
  'WG partition',
  'WG HiZ pyramid',
  'WG material surfaces v1',
  'WG shadow atlas v1',
  'WG shadow cull',
  'WG light tiles v1',
  'WG bounce probes v1',
  'WG deferred lighting',
  'WG HDR composition + present',
  'WG unknown pass',
];
const releve = (passes: number): GpuPassTimings => ({
  frame: 0,
  totalMs: null,
  truncated: false,
  passes: Array.from({ length: passes }, (_, i) => ({
    name: ETIQUETTES[i % ETIQUETTES.length],
    gpuMs: alea() < 0.1 ? null : alea() * 2,
  })),
});
const releves = (n: number, passes: number): GpuPassTimings[] =>
  Array.from({ length: n }, () => releve(passes));

const echantillonTronque: (GpuPassTimings | null)[] = [
  { frame: 0, totalMs: null, truncated: true, passes: [] },
];
const sansEchantillon: (GpuPassTimings | null)[] = [null];

const mesureGpu = await mesure({
  name: 'GPU passes per stage',
  fichier: 'packages/sdk-browser/stageMapping.ts',
  cas: [
    { name: '200 samples of 22 passes', input: releves(200, 22), size: 200 * 22 },
    { name: 'truncated sample', input: echantillonTronque, size: 1 },
    { name: 'no sample', input: sansEchantillon, size: 1 },
  ],
  calcul: depose(addGpuPasses),
  attendu: depose(referenceGpuStages),
});

const mesureEclairage = await mesure({
  name: 'direct-lighting durations',
  fichier: 'packages/sdk-browser/stageMapping.ts',
  cas: [{ name: '1 000 samples', input: releves(1000, 11), size: 1000 }],
  calcul: (input: GpuPassTimings[]) => input.map(directLightTimings),
  attendu: (input: GpuPassTimings[]) => input.map(referenceDirectLightTimings),
});

await stress({
  name: 'extreme per-stage profile',
  calcul: (sample) => {
    addGpuPasses(sample, () => {});
    directLightTimings(sample);
  },
  extremes: [
    {
      name: 'gpuMs NaN',
      input: {
        frame: 0,
        totalMs: null,
        truncated: false,
        passes: [{ name: 'WG partition', gpuMs: NaN }],
      },
    },
  ],
});

rapport(
  'profil-etapes',
  [mesureCpu, mesureGpu, mesureEclairage],
  'the per-stage profile deposits the same durations as its reference',
);
