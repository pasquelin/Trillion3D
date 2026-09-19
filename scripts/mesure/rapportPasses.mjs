/** `p50 / p95` of a distribution, or "unmeasured": a dash would not be distinct from a zero. */
export const p50p95 = (d) => (d ? `${d.p50.toFixed(3)} / ${d.p95.toFixed(3)}` : 'unmeasured');
const BLOCS = [
  ['visibilityMs', 'Visibility buffer'],
  ['materialsMs', 'Materials pass'],
  ['otherMs', 'The rest'],
];

/**
 * Comparable blocks then each pass of a side, under its per-stage table. The blocks are those a
 * published profile names — visibility buffer, materials pass — and nothing else: a pass that
 * neither side covers is in "the rest", named in the table below.
 */
export function passes(passesGpu) {
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
