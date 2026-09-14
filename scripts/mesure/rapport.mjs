// Statistiques, écarts d'images, charge machine et `resume.md`, pour `banc.mjs`.
import { execFileSync } from 'node:child_process';

const quantile = (s, p) => s[Math.min(s.length - 1, Math.ceil(s.length * p) - 1)];

/** p50/p95/p99 d'une série, ou `null` si elle est vide : rien n'est déduit d'une série absente. */
export function distribution(values) {
  const s = (values ?? []).filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  if (!s.length) return null;
  return {
    n: s.length,
    p50: quantile(s, 0.5),
    p95: quantile(s, 0.95),
    p99: quantile(s, 0.99),
    min: s[0],
    max: s.at(-1),
  };
}

/** Les trois moyennes de charge du système, lues telles quelles. */
export function machineLoad() {
  const line = execFileSync('uptime', { encoding: 'utf8' });
  const match = line.match(/load averages?:\s*([\d.,]+)[\s,]+([\d.,]+)[\s,]+([\d.,]+)/);
  if (!match) return null;
  return match.slice(1, 4).map((value) => Number(value.replace(',', '.')));
}

/** Écart entre deux captures RGBA : pixels différents et écart maximal par canal. */
export function imageDiff(a, b) {
  if (!a || !b) return null;
  if (a.w !== b.w || a.h !== b.h)
    return { erreur: `tailles différentes ${a.w}×${a.h} / ${b.w}×${b.h}` };
  const left = a.body,
    right = b.body;
  if (left.length !== right.length) return { erreur: 'longueurs de tampon différentes' };
  const maxParCanal = [0, 0, 0, 0];
  let pixels = 0;
  for (let i = 0; i < left.length; i += 4) {
    let differe = false;
    for (let c = 0; c < 4; c++) {
      const delta = Math.abs(left[i + c] - right[i + c]);
      if (delta > maxParCanal[c]) maxParCanal[c] = delta;
      if (delta) differe = true;
    }
    if (differe) pixels++;
  }
  return { pixels, maxParCanal, total: left.length / 4 };
}

const ms = (d, key) => (d ? d[key].toFixed(3) : '—');
const num = (value) => (value == null ? '—' : String(value));
const diffText = (d) =>
  !d ? '—' : d.erreur ? d.erreur : `${d.pixels} px, max canal ${d.maxParCanal.join('/')}`;

/** Le tableau de la série : une ligne par vue, par seuil et par côté. */
function rows(report) {
  const lines = [
    '| vue | pixelError | côté | cpuFrameMs p50/p95 | cpuSelectMs p50/p95 | gpuFrameMs p50 | selectedTriangles | uncoveredTriangles | Hi-Z testés/rejetés/>16 | hash coupe | budget pages |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const serie of report.series)
    for (const [side, r] of Object.entries(serie.sides)) {
      const hiz = r.hiZ;
      lines.push(
        `| ${serie.view} | ${serie.pixelError} | ${side} | ${ms(r.cpuFrameMs, 'p50')} / ${ms(r.cpuFrameMs, 'p95')} ` +
          `| ${ms(r.cpuSelectMs, 'p50')} / ${ms(r.cpuSelectMs, 'p95')} | ${ms(r.gpuFrameMs, 'p50')} ` +
          `| ${num(r.selectedTriangles)} | ${num(r.uncoveredTriangles)} ` +
          `| ${num(hiz.tested)}/${num(hiz.rejected)}/${num(hiz.beyond16Texels)} ` +
          `| ${r.selection.sha256 ? r.selection.sha256.slice(0, 12) : '—'} (${num(r.selection.source)}) ` +
          `| ${num(r.budgetPages.demande)} demandées, ${num(r.budgetPages.residentes)} résidentes |`,
      );
    }
  return lines;
}

/** `resume.md` : ce que la série a relevé, et rien d'autre. Un tiret est une absence, pas un zéro. */
export function resume(report) {
  const lines = [
    `# Mesure ${report.engine} — ${report.scene}`,
    '',
    `- Harnais : \`${report.commande}\``,
    `- HEAD du dépôt : \`${report.head}\` — côtés : ` +
      Object.entries(report.sides)
        .map(([name, side]) => `${name} = ${side.from}`)
        .join(', '),
    `- Images par série : ${report.settings.frames} (chauffe ${report.settings.warmup}), ` +
      `${report.settings.width}×${report.settings.height}, budget ${report.settings.maxPages} pages`,
    `- Début ${report.startedAt}, fin ${report.finishedAt}`,
    '',
    '## Relevés',
    '',
    ...rows(report),
    '',
    '## Témoin A/A et écart avant/après',
    '',
    '| vue | pixelError | témoin A/A (même côté, deux captures) | avant vs après |',
    '|---|---|---|---|',
    ...report.series.map(
      (s) =>
        `| ${s.view} | ${s.pixelError} | ${diffText(s.temoinAA)} | ${diffText(s.ecartAvantApres)} |`,
    ),
    '',
    '## Charge machine',
    '',
    '| vue | pixelError | côté | charge au début | charge à la fin |',
    '|---|---|---|---|---|',
    ...report.series.flatMap((s) =>
      Object.entries(s.sides).map(
        ([side, r]) =>
          `| ${s.view} | ${s.pixelError} | ${side} | ${r.charge.debut?.join(' ') ?? '—'} | ${r.charge.fin?.join(' ') ?? '—'} |`,
      ),
    ),
    '',
    "Aucune de ces durées n'est une mesure de performance tant que la charge machine n'a pas été",
    "jugée acceptable par l'appelant : le harnais la relève, il ne la juge pas.",
    '',
  ];
  if (report.errors.length) {
    lines.push('## Erreurs de page', '');
    for (const error of report.errors.slice(0, 40))
      lines.push(`- ${error.kind} : ${error.message ?? error.status + ' ' + error.url}`);
    lines.push('');
  }
  return lines.join('\n');
}
