// Statistiques, écarts d'images, charge machine et `resume.md`, pour `banc.mjs`.
// Les calculs sont ceux du SDK : mêmes quantiles, même comparaison d'images que le Lab.
import { loadavg } from 'node:os';
import { compareImages, summarize } from '../../packages/sdk-core/index.ts';

/** p50/p95/p99 d'une série, ou `null` si elle est vide : rien n'est déduit d'une série absente. */
export const distribution = (values) => summarize(values ?? []);

/** Les trois moyennes de charge du système, lues telles quelles. */
export const machineLoad = () => loadavg();

/** Écart entre deux captures RGBA : pixels différents et écart maximal sur un canal. */
export function imageDiff(a, b) {
  if (!a || !b) return null;
  if (a.w !== b.w || a.h !== b.h)
    return { erreur: `tailles différentes ${a.w}×${a.h} / ${b.w}×${b.h}` };
  const diff = compareImages(a.body, b.body);
  return { pixels: diff.differentPixels, maxCanal: diff.maxChannelError, total: a.w * a.h };
}

const ms = (d, key) => (d ? d[key].toFixed(3) : '—');
const num = (value) => (value == null ? '—' : String(value));
const diffText = (d) =>
  !d ? '—' : d.erreur ? d.erreur : `${d.pixels} px, max canal ${d.maxCanal}`;

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

/** `p50 / p95` d'une étape, ou « non mesuré » : un tiret ne serait pas distinct d'un zéro. */
const etape = (q) => (q ? `${q.p50.toFixed(3)} / ${q.p95.toFixed(3)}` : 'non mesuré');

/** Les compteurs d'une étape, sur une seule ligne ; vide quand l'étape n'en porte pas. */
const compteurs = (counts) =>
  Object.entries(counts ?? {})
    .map(([nom, valeur]) => `${nom} ${valeur}`)
    .join(', ');

/** Le découpage par étape d'une série : une ligne par étape, processeur et carte graphique séparés. */
function etapes(report) {
  const lines = [];
  for (const serie of report.series)
    for (const [side, resultat] of Object.entries(serie.sides)) {
      const titre = `### ${serie.view} · e${serie.pixelError} · ${side}`;
      const profile = resultat.profilParEtape;
      if (!profile || !profile.enabled) {
        lines.push(`${titre} : profil par étape absent`, '');
        continue;
      }
      lines.push(
        titre,
        '',
        `- Moteur \`${profile.backend}\`, ${profile.cpuFrames} images processeur, ` +
          `${profile.gpuSamples} relevés carte graphique sur une fenêtre de ${profile.windowFrames}`,
        `- Mesure carte graphique : ${profile.gpuMethod ?? 'non mesurée'}` +
          (profile.gpuReason ? ` (${profile.gpuReason})` : ''),
        `- Coût du profil lui-même : ${etape(profile.overheadMs)} ms par image`,
        `- Image entière côté carte graphique (enveloppe) : ${etape(profile.gpuImageMs)} ms — les`,
        '  durées par étape ne s’y additionnent pas : cet appareil peut faire se chevaucher deux passes,',
        '  et une somme les compterait deux fois.',
        '',
        '| étape | CPU ms p50/p95 | GPU ms p50/p95 | compteurs |',
        '|---|---|---|---|',
        ...profile.stages.map(
          (stage) =>
            `| ${stage.label} | ${etape(stage.cpuMs)} | ${etape(stage.gpuMs)} ` +
            `| ${compteurs(stage.counts)} |`,
        ),
        '',
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
    '## Coût par étape',
    '',
    'Les deux colonnes ne sont jamais additionnées : le processeur et la carte graphique travaillent',
    "en même temps. « non mesuré » n'est pas zéro.",
    '',
    ...etapes(report),
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
