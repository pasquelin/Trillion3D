import { go, mo } from './rapportTextures.ts';

const num = (v) => (typeof v === 'number' ? v : null);
/** Labels published in the summary: beyond them, the full reading is in `mesure.json`. */
const PLUS_LOURDES = 8;

/**
 * GPU memory per side and per view, read from the allocation registry the engine publishes: the
 * total is what it allocated and did not destroy, computed from each descriptor — WebGPU does not
 * publish occupied memory. The three named families come from the engine counters (computed texture
 * pool, allocated geometry and the requested reservoir, frame targets that follow resolution);
 * the rest is the difference. A side without a registry is "unmeasured", never zero. A reservoir
 * the engine could not hold as requested says why, in parentheses.
 */
export function memoire(report) {
  const lines = [
    '| view | threshold | side | total allocated | texture pool | geometry / pool | frame targets | rest |',
    '|---|---|---|---|---|---|---|---|',
  ];
  const details = [];
  for (const serie of report.series)
    for (const [side, resultat] of Object.entries(serie.sides)) {
      const m = resultat.metrics ?? {};
      const total = num(m.gpuAllocatedBytes);
      const atlas = num(m.texturePoolBytes),
        geometrie = num(m.geometryAllocationBytes),
        cibles = num(m.gpuFrameTargetBytes);
      const reste = total === null ? null : total - (atlas ?? 0) - (geometrie ?? 0) - (cibles ?? 0);
      lines.push(
        `| ${serie.view} | e${serie.pixelError} | ${side} | ${go(total)} | ${go(atlas)} ` +
          `| ${go(geometrie)} / ${mo(m.geometryPoolBytes)}${borne(m)} | ${mo(cibles)} | ${go(reste)} |`,
      );
      details.push(...plusLourdes(serie, side, m));
    }
  return [...lines, '', ...details];
}

const borne = (m) => (m.geometryPoolClamp ? ` (${m.geometryPoolClamp})` : '');

/** The heaviest allocations of a side, by label, and the admission of an unknown format. */
function plusLourdes(serie, side, m) {
  if (typeof m.gpuAllocatedBytes !== 'number') return [];
  const inconnues = num(m.gpuAllocationsUnknownFormat);
  const parEtiquette = Object.entries(m.gpuAllocatedByLabel ?? {})
    .slice(0, PLUS_LOURDES)
    .map(([label, bytes]) => `${label} ${mo(bytes)}`)
    .join(', ');
  return [
    `- ${serie.view} · e${serie.pixelError} · ${side}, heaviest: ${parEtiquette || 'none'}` +
      (inconnues
        ? ` — ${inconnues} texture(s) of a format unknown to the registry, counted as zero: this total is not a proof`
        : ''),
  ];
}
