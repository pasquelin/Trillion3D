// Lecture des `mesure.json` d'une campagne : un relevé plat par (exécution, vue, seuil, côté), avec
// les chiffres que `rapportGlobal.mjs` met en regard. Aucun chiffre n'est inventé : une grandeur
// que le banc n'a pas publiée vaut `null`, et le rapport l'écrit « non mesuré ».
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gpuPassBlockOf, gpuPassStageOf } from '../../packages/sdk-browser/gpuPassBlocks.ts';
import { VIEWS } from './poses.mjs';

/** Les vues du banc et leur nom lisible, pour tout le rapport. */
export const VUES = Object.keys(VIEWS);
export const DEUX_VUES = ['generale', 'sol'];
export const QUALITES = ['qualité maximale (0 px d’erreur)', 'qualité normale (1 px d’erreur)'];
export const LIBELLE = { generale: 'Vue générale', sol: 'Sol', rue: 'Rue', detail: 'Détail' };

const p50 = (stat) => stat?.p50 ?? null;
const p95 = (stat) => stat?.p95 ?? null;

/** Le relevé d'un côté d'une série : tout ce que le rapport lit, à plat. */
function releve(run, serie, nom, side) {
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
  // L'enveloppe carte : celle du profil par étape, sinon celle que la page a relevée elle-même ;
  // et le temps mur synchronisé du témoin Three (rendu puis attente carte).
  const gpu = profil?.gpuImageMs ?? side.gpuFrameMs;
  const gpuP50 = p50(gpu),
    imageSyncP50 = p50(side.imageSyncMs);
  // Le bloc se relit dans la table du moteur d'aujourd'hui, pas dans celle du jour du relevé.
  const liste = passes.map((pass) => ({
    nom: pass.name,
    bloc: gpuPassBlockOf(pass.name),
    etape: gpuPassStageOf(pass.name),
    p50: p50(pass.gpuMs),
    p95: p95(pass.gpuMs),
  }));
  return {
    run,
    vue: serie.view,
    seuil: serie.pixelError,
    cote: nom,
    // Millisecondes : processeur par image, enveloppe carte graphique, cadence.
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
    // Ce que ce côté appelle « une image » : l'enveloppe carte quand il la relève, sinon le temps
    // mur synchronisé. Les fiches comparent les côtés par ce seul chiffre.
    imageMs: gpuP50 ?? imageSyncP50,
    imageTenue: side.imageTenue ?? null,
    // Passes et étapes, telles quelles.
    passes: liste,
    blocs: side.passesGpu?.blocs
      ? {
          visibilite: p50(side.passesGpu.blocs.visibilityMs),
          materiaux: p50(side.passesGpu.blocs.materialsMs),
          reste: p50(side.passesGpu.blocs.otherMs),
        }
      : null,
    etapes,
    passe: (nom) => liste.find((p) => p.nom === nom) ?? null,
    etape,
    // Géométrie et sélection.
    triangles: side.selectedTriangles ?? null,
    trianglesDessines: side.drawnTriangles ?? null,
    trianglesNonCouverts: side.uncoveredTriangles ?? null,
    appelsDeDessin: metrics.drawCalls ?? null,
    hiZ: side.hiZ ?? null,
    pagesResidentes: side.budgetPages?.residentes ?? null,
    pagesDemandees: side.budgetPages?.demande ?? null,
    couvertureLimitee: side.budgetPages?.couvertureLimiteeParBudget ?? null,
    geometrieOctets: side.geometrieOctets ?? null,
    // Triangles uniques de la scène chez un témoin qui les compte (pages Three) : ses octets par triangle.
    trianglesUniques: metrics.uniqueTriangles ?? null,
    decodageWasm: metrics.pagesDecodedWasm ?? null,
    // Textures.
    texturesEngagees: metrics.textureResidentBytes ?? null,
    texturesPool: metrics.texturePoolBytes ?? null,
    tuilesAuNiveau: metrics.textureTilesAtLevel ?? null,
    tuilesDemandees: metrics.textureTilesRequested ?? null,
    texturesEvictions: metrics.textureTilesEvicted ?? null,
    // Lumière.
    lampesActives: metrics.lightsActive ?? null,
    ombres: etape('shadows')?.compteurs ?? null,
    rebond: etape('bounce')?.compteurs ?? null,
    atlasOmbres: side.atlasOmbres ?? null,
    // Fidélité et contexte.
    temoinAA: serie.temoinAA ?? null,
    ecart: serie.ecartAvantApres ?? null,
    coupeIdentique: serie.coupeIdentique ?? null,
    reseau: side.reseau ?? null,
    preparationMs: side.preparationMs ?? null,
    charge: side.charge ?? null,
    png: side.png ? join(run, side.png) : null,
  };
}

/** Une exécution de la campagne : ses réglages et tous ses relevés. */
function lireExecution(dossier, nom) {
  const fichier = join(dossier, nom, 'mesure.json');
  const log = join(dossier, nom, 'campagne.log');
  if (!existsSync(fichier)) {
    const texte = existsSync(log) ? readFileSync(log, 'utf8') : '';
    const erreur = texte
      .split('\n')
      .filter((l) => /erreur|error|refus/i.test(l))
      .slice(-3)
      .join(' · ');
    return { nom, absent: true, erreur: erreur || 'aucun mesure.json', releves: [] };
  }
  const m = JSON.parse(readFileSync(fichier, 'utf8'));
  const releves = [];
  for (const serie of m.series)
    for (const [cote, side] of Object.entries(serie.sides ?? {}))
      if (!cote.endsWith('-aa')) releves.push(releve(nom, serie, cote, side));
  return {
    nom,
    absent: false,
    head: m.head,
    scene: m.scene,
    erreurs: m.errors ?? [],
    debut: m.startedAt,
    fin: m.finishedAt,
    releves,
  };
}

/** Toutes les exécutions d'un dossier de campagne, dans l'ordre de la campagne si elle est donnée. */
export function lireCampagne(dossier, ordre = null) {
  const noms = readdirSync(dossier, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== 'vignettes')
    .filter((d) => {
      const path = join(dossier, d.name);
      if (existsSync(join(path, 'mesure.json'))) return true;
      return !readdirSync(path, { withFileTypes: true }).some(
        (e) => e.isDirectory() && existsSync(join(path, e.name, 'mesure.json')),
      );
    })
    .map((d) => d.name);
  const rangs = new Map((ordre ?? []).map(([nom, pourquoi], i) => [nom, { i, pourquoi }]));
  noms.sort((a, b) => (rangs.get(a)?.i ?? 0) - (rangs.get(b)?.i ?? 0) || a.localeCompare(b));
  const executions = noms.map((nom) => lireExecution(dossier, nom));
  for (const ex of executions) ex.pourquoi = rangs.get(ex.nom)?.pourquoi ?? '';
  return executions;
}

/** Le relevé d'une exécution pour une vue, un seuil et un côté (le premier côté par défaut). */
export function trouve(executions, nom, vue, seuil = 1, cote = null) {
  const ex = executions.find((e) => e.nom === nom);
  return (
    ex?.releves.find(
      (r) => r.vue === vue && r.seuil === seuil && (cote === null || r.cote === cote),
    ) ?? null
  );
}

/** Les deux côtés d'une exécution à deux moteurs : `[avant, apres]` (Three nu, puis le moteur). */
export const paire = (executions, nom, vue, seuil = 1) => [
  trouve(executions, nom, vue, seuil, 'avant'),
  trouve(executions, nom, vue, seuil, 'apres'),
];
