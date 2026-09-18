// Statistiques, écarts d'images, charge machine et `resume.md`, pour `banc.mjs`.
// Les calculs sont ceux du SDK : mêmes quantiles, même comparaison d'images partout.
import { loadavg } from 'node:os';
import { compareImages, summarize } from '../../packages/sdk-core/index.ts';
import { cheminsCalcul } from './rapportCalcul.mjs';
import { p50p95, passes } from './rapportPasses.mjs';
import { textures } from './rapportTextures.mjs';
import { memoire } from './rapportMemoire.mjs';

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
/** Des octets en mégaoctets, ou un tiret : un zéro ne serait pas distinct d'un relevé absent. */
const mo = (value) => (value == null ? '—' : (value / (1024 * 1024)).toFixed(1));
/** Un témoin à trois états : `oui`, `non`, ou un tiret quand ce moteur ne le publie pas. */
const oui = (value) => (value == null ? '—' : value ? 'oui' : 'non');
/** Les réservoirs demandés au moteur : en Mio quand le banc les a donnés, sinon ses défauts. */
const pool = (bytes) => (bytes == null ? 'défaut du moteur' : `${mo(bytes)} Mio`);
const budgets = (settings) => {
  const parts = [
    `pool géométrie ${pool(settings.geometryPoolBytes)}`,
    `pool textures ${pool(settings.texturePoolBytes)}`,
  ];
  if (settings.maxPages != null) parts.push(`plafond ${settings.maxPages} pages`);
  return parts.join(', ');
};
const diffText = (d) =>
  !d ? '—' : d.erreur ? d.erreur : `${d.pixels} px, max canal ${d.maxCanal}`;
/**
 * La relation de couverture d'un relevé : `selected − drawn − uncovered`. Zéro dit que chaque
 * triangle de la coupe est soit remis au dessin, soit compté comme trou ; autre chose dit qu'un des
 * trois compteurs décrit une autre image. Un tiret quand l'un des trois manque — rien n'est déduit.
 */
const couverture = (r) =>
  r.selectedTriangles == null || r.drawnTriangles == null || r.uncoveredTriangles == null
    ? '—'
    : String(r.selectedTriangles - r.drawnTriangles - r.uncoveredTriangles);

/** Le tableau de la série : une ligne par vue, par seuil et par côté. */
function rows(report) {
  const lines = [
    '| vue | pixelError | côté | cpuFrameMs p50/p95 | cpuSelectMs p50/p95 | gpuFrameMs p50 | selectedTriangles | drawnTriangles | couverture | triangles soumis opaque/total | image tenue | uncoveredTriangles | repli sélection GPU | Hi-Z testés/rejetés/>16 (image) | hash coupe | budget pages | géométrie (Mo) |',
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
          `| ${num(r.budgetPages.demande)} demandées, ${num(r.budgetPages.residentes)} résidentes ` +
          `| ${mo(r.geometrieOctets)} |`,
      );
    }
  return lines;
}

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
        `- Coût du profil lui-même : ${p50p95(profile.overheadMs)} ms par image`,
        `- Image entière côté carte graphique (enveloppe) : ${p50p95(profile.gpuImageMs)} ms — les`,
        '  durées par étape ne s’y additionnent pas : cet appareil peut faire se chevaucher deux passes,',
        '  et une somme les compterait deux fois.',
        '',
        '| étape | CPU ms p50/p95 | GPU ms p50/p95 | compteurs |',
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
      `${report.settings.width}×${report.settings.height}, ${budgets(report.settings)}`,
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
    '## Chemin de calcul en lot',
    '',
    'Le chemin publié est celui que le gouverneur a choisi par la mesure, opération par opération :',
    "aucun seuil n'est écrit dans le code, et « non mesuré » n'est pas zéro.",
    '',
    ...cheminsCalcul(report),
    '',
    '## Mémoire carte graphique',
    '',
    "Le total est ce que le moteur a alloué sur l'appareil et pas encore détruit, calculé depuis",
    "chaque descripteur : WebGPU ne publie pas la mémoire occupée. « non mesuré » n'est pas zéro.",
    '',
    ...memoire(report),
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
