// Reading `mesure.json` files of a campaign: one flat reading per (run, view, threshold, side),
// with the figures that `rapportGlobal.mjs` puts side by side. No figure is invented: a quantity
// the bench did not publish is `null`, and the report writes "unmeasured".
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gpuPassBlockOf, gpuPassStageOf } from '../../packages/sdk-browser/gpuPassBlocks.ts';
import { VIEWS } from './poses.mjs';

/** Bench views and their readable name, for the whole report. */
export const VIEW_IDS = Object.keys(VIEWS);
export const TWO_VIEWS = ['generale', 'sol'];
export const QUALITES = ['maximum quality (0 px error)', 'normal quality (1 px error)'];
export const LIBELLE = {
  generale: 'Overview',
  sol: 'Street',
  rue: 'Street corner',
  detail: 'Close-up',
};

const p50 = (stat) => stat?.p50 ?? null;
const p95 = (stat) => stat?.p95 ?? null;

/** Reading of one side of a series: everything the report reads, flattened. */
function reading(run, serie, name, side) {
  const profil = side.profilParEtape ?? null;
  const stages = profil?.stages ?? [];
  const passes = side.passesGpu?.passes ?? [];
  const metrics = side.metrics ?? {};
  const etapes = stages.map((s) => ({
    etape: s.stage,
    libelle: s.label,
    cpuP50: p50(s.cpuMs),
    cpuP95: p95(s.cpuMs),
    gpuP50: p50(s.gpuMs),
    compteurs: s.counts ?? null,
    raisonCpu: s.cpuReason ?? null,
    raisonGpu: s.gpuReason ?? null,
  }));
  const etape = (stage) => etapes.find((e) => e.etape === stage) ?? null;
  // GPU envelope: that of the per-stage profile, otherwise the one the page recorded itself;
  // and the synchronised wall time of the Three witness (render then GPU wait).
  const gpu = profil?.gpuImageMs ?? side.gpuFrameMs;
  const gpuP50 = p50(gpu),
    imageSyncP50 = p50(side.imageSyncMs);
  // The block is reread from today's engine table, not from the one of the reading day.
  const liste = passes.map((pass) => ({
    name: pass.name,
    bloc: gpuPassBlockOf(pass.name),
    etape: gpuPassStageOf(pass.name),
    p50: p50(pass.gpuMs),
    p95: p95(pass.gpuMs),
  }));
  return {
    run,
    vue: serie.view,
    seuil: serie.pixelError,
    side: name,
    // Milliseconds: CPU per frame, GPU envelope, cadence.
    cpuP50: p50(side.cpuFrameMs),
    cpuP95: p95(side.cpuFrameMs),
    cpuSelectP50: p50(side.cpuSelectMs),
    gpuP50,
    gpuP95: p95(gpu),
    gpuReleves: profil?.gpuSamples ?? 0,
    gpuMethode: profil?.gpuMethod ?? null,
    profilCoutP50: p50(profil?.overheadMs),
    rafP50: p50(side.rafIntervalMs),
    imageSyncP50,
    imageSyncP95: p95(side.imageSyncMs),
    // What this side calls "a frame": the GPU envelope when it records it, otherwise the
    // synchronised wall time. Cards compare sides by this single figure.
    imageMs: gpuP50 ?? imageSyncP50,
    imageTenue: side.imageTenue ?? null,
    // Passes and stages, as-is.
    passes: liste,
    blocs: side.passesGpu?.blocs
      ? {
          visibilite: p50(side.passesGpu.blocs.visibilityMs),
          materiaux: p50(side.passesGpu.blocs.materialsMs),
          reste: p50(side.passesGpu.blocs.otherMs),
        }
      : null,
    etapes,
    passe: (name) => liste.find((p) => p.name === name) ?? null,
    etape,
    // Geometry and selection.
    triangles: side.selectedTriangles ?? null,
    trianglesDessines: side.drawnTriangles ?? null,
    trianglesNonCouverts: side.uncoveredTriangles ?? null,
    appelsDeDessin: metrics.drawCalls ?? null,
    hiZ: side.hiZ ?? null,
    pagesResidentes: side.budgetPages?.residentes ?? null,
    pagesDemandees: side.budgetPages?.demande ?? null,
    couvertureLimitee: side.budgetPages?.couvertureLimiteeParBudget ?? null,
    geometrieOctets: side.geometrieOctets ?? null,
    // Unique triangles of the scene at a witness that counts them (Three pages): its bytes per triangle.
    trianglesUniques: metrics.uniqueTriangles ?? null,
    decodageWasm: metrics.pagesDecodedWasm ?? null,
    // Textures.
    texturesEngagees: metrics.textureResidentBytes ?? null,
    texturesPool: metrics.texturePoolBytes ?? null,
    tuilesAuNiveau: metrics.textureTilesAtLevel ?? null,
    tuilesDemandees: metrics.textureTilesRequested ?? null,
    texturesEvictions: metrics.textureTilesEvicted ?? null,
    // Lighting.
    lampesActives: metrics.lightsActive ?? null,
    ombres: etape('shadows')?.compteurs ?? null,
    rebond: etape('bounce')?.compteurs ?? null,
    atlasOmbres: side.atlasOmbres ?? null,
    // Fidelity and context.
    temoinAA: serie.temoinAA ?? null,
    ecart: serie.ecartAvantApres ?? null,
    coupeIdentique: serie.coupeIdentique ?? null,
    reseau: side.reseau ?? null,
    preparationMs: side.preparationMs ?? null,
    charge: side.charge ?? null,
    png: side.png ? join(run, side.png) : null,
  };
}

/** A campaign run: its settings and all its readings. */
function lireExecution(dossier, name) {
  const fichier = join(dossier, name, 'mesure.json');
  const log = join(dossier, name, 'campagne.log');
  if (!existsSync(fichier)) {
    const texte = existsSync(log) ? readFileSync(log, 'utf8') : '';
    const erreur = texte
      .split('\n')
      .filter((l) => /erreur|error|refus/i.test(l))
      .slice(-3)
      .join(' · ');
    return { name, absent: true, erreur: erreur || 'no mesure.json', readings: [] };
  }
  const m = JSON.parse(readFileSync(fichier, 'utf8'));
  const readings = [];
  for (const serie of m.series)
    for (const [sideName, sideData] of Object.entries(serie.sides ?? {}))
      if (!sideName.endsWith('-aa')) readings.push(reading(name, serie, sideName, sideData));
  return {
    name,
    absent: false,
    head: m.head,
    scene: m.scene,
    erreurs: m.errors ?? [],
    debut: m.startedAt,
    fin: m.finishedAt,
    readings,
  };
}

/** All runs of a campaign folder, in campaign order if given. */
export function lireCampagne(dossier, ordre = null) {
  const names = readdirSync(dossier, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== 'vignettes')
    .filter((d) => {
      const path = join(dossier, d.name);
      if (existsSync(join(path, 'mesure.json'))) return true;
      return !readdirSync(path, { withFileTypes: true }).some(
        (e) => e.isDirectory() && existsSync(join(path, e.name, 'mesure.json')),
      );
    })
    .map((d) => d.name);
  const rangs = new Map((ordre ?? []).map(([name, pourquoi], i) => [name, { i, pourquoi }]));
  names.sort((a, b) => (rangs.get(a)?.i ?? 0) - (rangs.get(b)?.i ?? 0) || a.localeCompare(b));
  const executions = names.map((name) => lireExecution(dossier, name));
  for (const ex of executions) ex.pourquoi = rangs.get(ex.name)?.pourquoi ?? '';
  return executions;
}

/** Reading of a run for a view, a threshold and a side (the first side by default). */
export function trouve(executions, name, vue, seuil = 1, side = null) {
  const ex = executions.find((e) => e.name === name);
  return (
    ex?.readings.find(
      (r) => r.vue === vue && r.seuil === seuil && (side === null || r.side === side),
    ) ?? null
  );
}

/** The two sides of a two-engine run: `[avant, apres]` (bare Three, then the engine). */
export const paire = (executions, name, vue, seuil = 1) => [
  trouve(executions, name, vue, seuil, 'avant'),
  trouve(executions, name, vue, seuil, 'apres'),
];
