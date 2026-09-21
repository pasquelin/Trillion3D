// Statistics, image deltas, machine load and `resume.md`, for `banc.ts`.
// The calculations are the SDK's: same quantiles, same image comparison everywhere.
import { loadavg } from 'node:os';
import { compareImages, summarize } from '../../packages/sdk-core/index.ts';
import { cheminsCalcul } from './rapportCalcul.ts';
import { p50p95, passes } from './rapportPasses.ts';
import { textures } from './rapportTextures.ts';
import { memoire } from './rapportMemoire.ts';

/** p50/p95/p99 of a series, or `null` if it is empty: nothing is inferred from an absent series. */
export const distribution = (values) => summarize(values ?? []);

/** The three system load averages, read as-is. */
export const machineLoad = () => loadavg();

/** Delta between two RGBA captures: different pixels and maximum error on a channel. */
export function imageDiff(a, b) {
  if (!a || !b) return null;
  if (a.w !== b.w || a.h !== b.h)
    return { erreur: `different sizes ${a.w}×${a.h} / ${b.w}×${b.h}` };
  const diff = compareImages(a.body, b.body);
  return { pixels: diff.differentPixels, maxCanal: diff.maxChannelError, total: a.w * a.h };
}

const ms = (d, key) => (d ? d[key].toFixed(3) : '—');
const num = (value) => (value == null ? '—' : String(value));
/** Bytes in megabytes, or a dash: a zero would not be distinct from an absent reading. */
const mo = (value) => (value == null ? '—' : (value / (1024 * 1024)).toFixed(1));
/** A three-state witness: `yes`, `no`, or a dash when this engine does not publish it. */
const oui = (value) => (value == null ? '—' : value ? 'yes' : 'no');
/** Reservoirs requested of the engine: in MiB when the bench gave them, otherwise its defaults. */
const pool = (bytes) => (bytes == null ? 'engine default' : `${mo(bytes)} MiB`);
const budgets = (settings) => {
  const parts = [
    `geometry pool ${pool(settings.geometryPoolBytes)}`,
    `texture pool ${pool(settings.texturePoolBytes)}`,
  ];
  if (settings.maxPages != null) parts.push(`ceiling ${settings.maxPages} pages`);
  return parts.join(', ');
};
const diffText = (d) =>
  !d ? '—' : d.erreur ? d.erreur : `${d.pixels} px, max channel ${d.maxCanal}`;
/**
 * Coverage relation of a reading: `selected − drawn − uncovered`. Zero says every triangle
 * of the cut is either submitted to draw or counted as a hole; anything else says one of
 * the three counters describes another image. A dash when one of the three is missing — nothing is inferred.
 */
const couverture = (r) =>
  r.selectedTriangles == null || r.drawnTriangles == null || r.uncoveredTriangles == null
    ? '—'
    : String(r.selectedTriangles - r.drawnTriangles - r.uncoveredTriangles);

/** The series table: one row per view, per threshold and per side. */
function rows(report) {
  const lines = [
    '| view | pixelError | side | cpuFrameMs p50/p95 | cpuSelectMs p50/p95 | gpuFrameMs p50 | selectedTriangles | drawnTriangles | coverage | submitted triangles opaque/total | held image | uncoveredTriangles | GPU selection fallback | Hi-Z tested/rejected/>16 (image) | cut hash | page budget | geometry (MB) |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const serie of report.series)
    for (const [side, r] of Object.entries(serie.sides)) {
      const hiz = r.hiZ;
      lines.push(
        `| ${serie.view} | ${serie.pixelError} | ${side}${r.moteur ? ` · ${r.moteur}` : ''} ` +
          `| ${ms(r.cpuFrameMs, 'p50')} / ${ms(r.cpuFrameMs, 'p95')} ` +
          `| ${ms(r.cpuSelectMs, 'p50')} / ${ms(r.cpuSelectMs, 'p95')} | ${ms(r.gpuFrameMs, 'p50')} ` +
          `| ${num(r.selectedTriangles)} | ${num(r.drawnTriangles)} | ${couverture(r)} ` +
          `| ${num(r.submittedTriangles)}/${num(r.totalSubmittedTriangles)} | ${oui(r.imageTenue)} ` +
          `| ${num(r.uncoveredTriangles)} | ${oui(r.repliSelectionGpu)} ` +
          `| ${num(hiz.tested)}/${num(hiz.rejected)}/${num(hiz.beyond16Texels)} (${num(hiz.image)}) ` +
          `| ${r.selection.sha256 ? r.selection.sha256.slice(0, 12) : '—'} (${num(r.selection.source)}) ` +
          `| ${num(r.budgetPages.demande)} requested, ${num(r.budgetPages.residentes)} resident, ` +
          `${num(r.budgetPages.seuilBudget)} px ` +
          `| ${mo(r.geometrieOctets)} |`,
      );
    }
  return lines;
}

/** Counters of a stage, on a single line; empty when the stage carries none. */
const compteurs = (counts) =>
  Object.entries(counts ?? {})
    .map(([nom, valeur]) => `${nom} ${valeur}`)
    .join(', ');

/** Per-stage breakdown of a series: one line per stage, CPU and GPU separated. */
function etapes(report) {
  const lines = [];
  for (const serie of report.series)
    for (const [side, resultat] of Object.entries(serie.sides)) {
      const titre = `### ${serie.view} · e${serie.pixelError} · ${side}`;
      const profile = resultat.profilParEtape;
      if (!profile || !profile.enabled) {
        lines.push(`${titre} : per-stage profile absent`, '');
        continue;
      }
      lines.push(
        titre,
        '',
        `- Engine \`${profile.backend}\`, ${profile.cpuFrames} CPU frames, ` +
          `${profile.gpuSamples} GPU readings on a window of ${profile.windowFrames}`,
        `- GPU measurement: ${profile.gpuMethod ?? 'unmeasured'}` +
          (profile.gpuReason ? ` (${profile.gpuReason})` : ''),
        `- Cost of the profile itself: ${p50p95(profile.overheadMs)} ms per frame`,
        `- Whole image on the GPU (envelope): ${p50p95(profile.gpuImageMs)} ms — the`,
        '  per-stage durations do not add up to it: this device may overlap two passes,',
        '  and a sum would count them twice.',
        '',
        '| stage | CPU ms p50/p95 | GPU ms p50/p95 | counters |',
        '|---|---|---|---|',
        ...profile.stages.map(
          (stage) =>
            `| ${stage.label} | ${p50p95(stage.cpuMs)} | ${p50p95(stage.gpuMs)} ` +
            `| ${compteurs(stage.counts)} |`,
        ),
        '',
        ...passes(resultat.passesGpu),
        ...textures(resultat.metrics, resultat),
      );
    }
  return lines;
}

/** `resume.md`: what the series recorded, and nothing else. A dash is an absence, not a zero. */
export function resume(report) {
  const lines = [
    `# Measurement ${report.engine} — ${report.scene}`,
    '',
    `- Harness: \`${report.commande}\``,
    `- Repository HEAD: \`${report.head}\` — sides: ` +
      Object.entries(report.sides)
        .map(([name, side]) => `${name} = ${side.from}`)
        .join(', '),
    `- Frames per series: ${report.settings.frames} (warmup ${report.settings.warmup}), ` +
      `${report.settings.width}×${report.settings.height}, ${budgets(report.settings)}`,
    `- Start ${report.startedAt}, end ${report.finishedAt}`,
    '',
    '## Readings',
    '',
    ...rows(report),
    '',
    '## Cost per stage',
    '',
    'The two columns are never added: the CPU and the GPU work',
    'at the same time. "unmeasured" is not zero.',
    '',
    ...etapes(report),
    '## Batch compute path',
    '',
    'The published path is the one the governor chose by measurement, operation by operation:',
    'no threshold is written in the code, and "unmeasured" is not zero.',
    '',
    ...cheminsCalcul(report),
    '',
    '## GPU memory',
    '',
    'The total is what the engine allocated on the device and has not yet destroyed, computed from',
    'each descriptor: WebGPU does not publish occupied memory. "unmeasured" is not zero.',
    '',
    ...memoire(report),
    '',
    '## A/A witness and before/after delta',
    '',
    '| view | pixelError | A/A witness (same side, two captures) | before vs after |',
    '|---|---|---|---|',
    ...report.series.map(
      (s) =>
        `| ${s.view} | ${s.pixelError} | ${diffText(s.temoinAA)} | ${diffText(s.ecartAvantApres)} |`,
    ),
    '',
    '## Machine load',
    '',
    '| view | pixelError | side | load at start | load at end |',
    '|---|---|---|---|---|',
    ...report.series.flatMap((s) =>
      Object.entries(s.sides).map(
        ([side, r]) =>
          `| ${s.view} | ${s.pixelError} | ${side} | ${r.charge.debut?.join(' ') ?? '—'} | ${r.charge.fin?.join(' ') ?? '—'} |`,
      ),
    ),
    '',
    'None of these durations is a performance measurement until the machine load has been',
    'judged acceptable by the caller: the harness records it, it does not judge it.',
    '',
  ];
  if (report.errors.length) {
    lines.push('## Page errors', '');
    for (const error of report.errors.slice(0, 40))
      lines.push(`- ${error.kind} : ${error.message ?? error.status + ' ' + error.url}`);
    lines.push('');
  }
  return lines.join('\n');
}
