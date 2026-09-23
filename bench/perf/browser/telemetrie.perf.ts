// Telemetry: frame intervals and hexadecimal digests, against the oracles of before batch A.
import { frameStatistics } from '../../../packages/sdk-core/src/index.ts';
import type { FrameMetrics } from '../../../packages/sdk-core/src/index.ts';
import { EngineProfiler } from '../../../packages/sdk-browser/src/diagnostic/telemetry.ts';
import { toHex } from '../../../packages/sdk-browser/src/measurement/sha256Hex.ts';
import { graine, mesure, stress, rapport } from '../../core/index.ts';
import { referenceHex, referenceIntervals } from '../../oracles/browser/telemetrie.ts';

const alea = graine(83);
const intervalles: number[] = [];
for (let i = 0; i < 2000; i++) intervalles.push(8 + alea() * 12);
const digests: Uint8Array[] = [];
for (let i = 0; i < 2000; i++) {
  const octets = new Uint8Array(32);
  for (let j = 0; j < 32; j++) octets[j] = Math.floor(alea() * 256);
  digests.push(octets);
}
// `record()` only stores this reference (`getReport()`, which reads it, is never called here):
// one shared placeholder, built once, keeps the timed loop free of a per-frame allocation.
const METRIQUES_VIDES: FrameMetrics = {
  rafIntervalMs: null,
  cpuFrameMs: 0,
  cpuSubmitMs: null,
  gpuMs: null,
  drawCalls: null,
  triangles: null,
  clusters: null,
  selectedTriangles: null,
  residentPages: null,
  geometryAllocationBytes: null,
  vramBytes: null,
  pageLoads: 0,
  pageBytesRead: 0,
};

const resTelemetry = await mesure({
  name: 'intervals and hexadecimal',
  fichier: 'packages/sdk-browser/src/diagnostic/telemetry.ts',
  cas: [
    { name: '2 000 frames, 2 000 digests', input: { intervalles, digests }, size: 2000 },
    { name: 'no frames', input: { intervalles: [], digests: [] }, size: 0 },
  ],
  calcul: ({ intervalles: valeurs, digests: liste }) => {
    const profil = new EngineProfiler(120);
    let horloge = 0;
    for (const dt of valeurs) profil.record(METRIQUES_VIDES, (horloge += dt));
    return { stats: frameStatistics(profil.orderedIntervals()), hex: liste.map(toHex) };
  },
  attendu: ({ intervalles: valeurs, digests: liste }) => ({
    stats: frameStatistics(referenceIntervals(120, valeurs)),
    hex: liste.map(referenceHex),
  }),
  options: { tours: 100, budgetMs: 1500 },
});

await stress({
  name: 'toHex extremes',
  calcul: toHex,
  extremes: [
    { name: 'zero bytes', input: new Uint8Array(0) },
    { name: 'one byte', input: new Uint8Array([255]) },
    { name: 'all zeros', input: new Uint8Array(32) },
  ],
});

rapport('telemetrie', [resTelemetry], 'A14 yields the exact same values');
