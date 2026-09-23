import type { summarize } from '../../packages/sdk-core/index.ts';
import type { GpuPassBlockTotals } from '../../packages/sdk-browser/gpuPassBlocks.ts';

/** p50/p95/p99 of a series, or `null` if it was empty. */
export type Distribution = ReturnType<typeof summarize>;

/** `p50 / p95` of a distribution, or "unmeasured": a dash would not be distinct from a zero. */
export const p50p95 = (d: { p50: number; p95: number } | null) =>
  d ? `${d.p50.toFixed(3)} / ${d.p95.toFixed(3)}` : 'unmeasured';
const BLOCS: [keyof GpuPassBlockTotals, string][] = [
  ['visibilityMs', 'Visibility buffer'],
  ['materialsMs', 'Materials pass'],
  ['otherMs', 'The rest'],
];

/** One GPU pass and its block, summarised over the readings of a series. */
interface PasseGpu {
  name: string;
  bloc: string | null;
  gpuMs: Distribution;
}

/** GPU passes and their comparable blocks, summarised over a series' readings. */
export interface PassesGpu {
  releves: number;
  blocs: Record<string, Distribution>;
  passes: PasseGpu[];
}

/**
 * Comparable blocks then each pass of a side, under its per-stage table. The blocks are those a
 * published profile names — visibility buffer, materials pass — and nothing else: a pass that
 * neither side covers is in "the rest", named in the table below.
 */
export function passes(passesGpu: PassesGpu | null) {
  if (!passesGpu) return ['- GPU passes: no reading', ''];
  return [
    `- Comparable blocks over ${passesGpu.releves} readings, GPU ms p50/p95: ` +
      BLOCS.map(([k, label]) => `${label} ${p50p95(passesGpu.blocs[k])}`).join(' · '),
    '',
    '| passe | GPU ms p50/p95 | bloc |',
    '|---|---|---|',
    ...passesGpu.passes.map((p) => `| ${p.name} | ${p50p95(p.gpuMs)} | ${p.bloc} |`),
    '',
  ];
}
