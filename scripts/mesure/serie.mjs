// Une série de mesure : un côté, une vue, un seuil. Écrit la capture et la coupe, rend la ligne.
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pngFromRgba } from './serveur.mjs';
import { distribution, machineLoad } from './rapport.mjs';
import { passesGpu } from './seriePasses.mjs';

/** Une série : un côté, une vue, un seuil. Écrit sa capture, renvoie sa ligne de rapport. */
export async function runSerie(ctx, page, side, view, pixelError, pose, captures, suffix = '') {
  const { MANIFEST, OUT, settings, lights, poses } = ctx;
  // Le moteur du côté : `--moteur-<côté>` le distingue de celui de la campagne, et c'est ainsi que
  // le moteur et le témoin Three se mesurent dans la même exécution.
  const ENGINE = side.engine;
  const captureFile = `${side.name}-${view}-e${pixelError}${suffix}.png`;
  const debut = machineLoad();
  const result = await runInPage(page, {
    sdkUrl: `/sdk/${side.name}/sdk-browser/index.js`,
    manifestUrl: side.manifestUrl ?? MANIFEST,
    backend: ENGINE.backend,
    engineId: ENGINE.id,
    autonome: ENGINE.autonome === true,
    // Les modules que la page importe par URL, et le témoin : un moteur qui dessine par Three ne
    // lit pas le magasin de lampes, l'hôte lui pose donc les mêmes lampes en Three.
    modulesUrl: '/mesure/',
    temoin: ENGINE.three === true,
    // La page de mesure du moteur, et la source qu'elle charge quand ce n'est pas le cache.
    page: ENGINE.page,
    gltfUrl: side.sourceUrl ?? null,
    pose,
    poses,
    captureFile,
    pixelError,
    frames: settings.frames,
    warmup: settings.warmup,
    maxPages: settings.maxPages,
    instances: settings.instances,
    width: settings.width,
    height: settings.height,
    stageProfile: settings.stageProfile,
    // La variante de diagnostic de ce côté : c'est elle qui fait de deux côtés deux variantes.
    variante: side.variante ?? null,
    // La métrique d'erreur écran de ce côté (EXPÉRIENCE) : `null` laisse la nôtre.
    erreur: side.erreur ?? null,
    trace: settings.trace === true,
    bounce: settings.bounce,
    importedLights: settings.importedLights,
    profileFrames: settings.profileFrames,
    lights: lights ? lights.lights : [],
    moving: lights ? lights.moving : null,
    shadowBudgetMs: settings.shadowBudgetMs,
    shadowPages: settings.shadowPages,
    shadowDigest: settings.shadowDigest,
    // Les textures lues dans le cache : seulement pour un moteur qui lit l'atlas, jamais le témoin.
    textureSource: settings.textureSource,
    temporalAntialiasing: settings.temporalAntialiasing,
    mathPath: settings.mathPath === 'auto' ? null : settings.mathPath,
    movingNode: settings.movingNode,
    movingNodeRadius: settings.movingNodeRadius,
  });
  const fin = machineLoad();
  if (result.erreur) throw new Error(`${side.name} ${view} e${pixelError} : ${result.erreur}`);
  const metrics = result.metrics ?? {};
  const capture = captures.get(captureFile);
  if (capture)
    await writeFile(join(OUT, captureFile), pngFromRgba(capture.body, capture.w, capture.h));
  const ids = result.selection.ids;
  await writeFile(
    join(OUT, `${captureFile.replace(/\.png$/, '')}.coupe.txt`),
    ids.join('\n') + '\n',
  );
  const row = {
    cpuFrameMs: distribution(result.cpuFrameMs),
    cpuSelectMs: distribution(result.cpuSelectMs),
    moteur: ENGINE.id,
    // L'enveloppe carte graphique d'une image, quand la page la relève (moteur WebGPU).
    gpuFrameMs: result.gpuFrameMs?.length ? distribution(result.gpuFrameMs) : null,
    // Temps mur d'une image synchronisée — rendu puis attente de la carte — quand la page le relève.
    imageSyncMs: result.syncFrameMs?.length ? distribution(result.syncFrameMs) : null,
    rafIntervalMs: result.rafIntervalMs?.length ? distribution(result.rafIntervalMs) : null,
    // Découpage par étape publié par le moteur : p50/p95, processeur et carte graphique séparés.
    profilParEtape: result.stageProfile ?? null,
    // Chaque passe de la carte et les blocs qu'un profil publié sait nommer, p50/p95 sur les
    // relevés de la même boucle que le profil ; `null` sans relevé.
    passesGpu: passesGpu(result.gpuPassSamples),
    // La préparation chronométrée dans la page, et les octets passés sur le réseau depuis, par sorte
    // de fichier ; `null` pour un dist d'avant ces deux relevés.
    preparationMs: typeof result.preparationMs === 'number' ? result.preparationMs : null,
    // Images rendues avant la capture pour que le moteur tienne la pose ; `null` s'il n'en tient pas.
    imagesCalme: typeof result.imagesCalme === 'number' ? result.imagesCalme : null,
    reseau: result.network ?? null,
    variante: side.variante ?? null,
    erreur: side.erreur ?? 'certifiee',
    selectedTriangles: metrics.selectedTriangles ?? null,
    uncoveredTriangles: metrics.uncoveredTriangles ?? null,
    // Triangles que l'image relevée a remis au dessin : la coupe moins son trou, comptée sans
    // attendre le retour de la carte. Avec les deux voisins, `selected − drawn − uncovered` doit
    // valoir zéro ; `resume.md` en fait sa colonne « couverture ». `null` hors de ce moteur.
    drawnTriangles: metrics.drawnTriangles ?? null,
    // Triangles réellement soumis au dessin, relevés sur la dernière image mesurée — `imageDuReleve`
    // la nomme. `submittedTriangles` est la passe opaque, `totalSubmittedTriangles` y ajoute les
    // passes transparentes. `null` quand le compte de la carte n'était pas encore revenu à ce
    // moment-là : la coupe choisie sur la carte publie ses totaux après coup.
    submittedTriangles: metrics.submittedTriangles ?? null,
    totalSubmittedTriangles: metrics.totalSubmittedTriangles ?? null,
    imageDuReleve: settings.frames > 0 ? settings.frames - 1 : null,
    // L'image relevée a-t-elle été tenue ? Une image tenue ne réencode qu'une présentation : ses
    // triangles soumis valent zéro parce qu'elle n'a rien dessiné, non parce que rien n'a compté.
    // Sans ce témoin, ce zéro-là ne se distingue pas d'une image vide. `null` hors de ce moteur.
    imageTenue: metrics.frameHeld ?? null,
    // Repli de la sélection : vrai quand ce moteur avait une coupe choisie sur la carte graphique et
    // l'a abandonnée pour la coupe processeur de secours. `null` sur un moteur sans coupe GPU.
    repliSelectionGpu: metrics.gpuSelectionFallback ?? null,
    // Compteurs d'occultation du contrat, sous leurs noms de contrat : le relevé les cherchait sous
    // des noms qui n'ont jamais existé et publiait donc `null` là où le moteur comptait. `image`
    // nomme celle qu'ils décrivent — antérieure sur le chemin GPU. `null` = non compté.
    hiZ: {
      tested: metrics.hizTestedClusters ?? null,
      rejected: metrics.hizRejectedClusters ?? null,
      beyond16Texels: metrics.hizOversizedClusters ?? null,
      testedTriangles: metrics.hizTestedTriangles ?? null,
      rejectedTriangles: metrics.hizRejectedTriangles ?? null,
      beyond16TexelsTriangles: metrics.hizOversizedTriangles ?? null,
      image: metrics.hizCountedFrame ?? null,
    },
    selection: {
      source: result.selection.source,
      sha256: result.selection.source
        ? createHash('sha256').update(ids.join('\n')).digest('hex')
        : null,
      taille: ids.length,
    },
    // Mémoire de géométrie publiée par le moteur : octets tenus par le cache de pages et les
    // tampons de sommets. `null` quand le moteur ne la publie pas, jamais déduite.
    geometrieOctets: metrics.geometryAllocationBytes ?? null,
    budgetPages: {
      demande: settings.maxPages,
      residentes: metrics.residentPages ?? null,
      couvertureLimiteeParBudget: metrics.coverageBudgetLimited ?? null,
    },
    // Le relevé du gouverneur de chemin de calcul : mode demandé, disponibilité du module, et pour
    // chaque opération en lot le chemin réellement joué avec les médianes des deux. `null` quand le
    // dist mesuré est antérieur au gouverneur — non mesuré, et non pas « chemin JavaScript ».
    cheminCalcul: result.mathBatch ?? null,
    lampes: lights ? lights.resume : null,
    // Les lampes venues du fichier source, telles que le moteur les a déclarées à l'ouverture.
    lampesFichier: result.importedLights ?? null,
    // Ce que le témoin Three a reçu du magasin ; `null` quand ce côté ne dessine pas par Three.
    lampesTemoin: result.lampesTemoin ?? null,
    // L'empreinte de l'atlas d'ombres, lue une fois la file d'attente vide. Deux exécutions dont
    // seule `--ombres-pages` diffère doivent rendre la même : c'est la preuve que le dessin par
    // pages est identique au bit près à un redessin complet.
    atlasOmbres: result.shadowAtlas ?? null,
    objetMobile: result.movingNode ?? null,
    charge: { debut, fin },
    png: capture ? captureFile : null,
    captureStatus: result.captureStatus,
    incidentsGpu: result.lost.length ? result.lost : null,
    canvas: result.size,
    metrics,
  };
  process.stdout.write(
    `${side.name} ${view} e${pixelError} : cpuFrame p50=${row.cpuFrameMs ? row.cpuFrameMs.p50.toFixed(2) : '—'} ` +
      `cpuSelect p50=${row.cpuSelectMs ? row.cpuSelectMs.p50.toFixed(2) : '—'} ` +
      `gpuFrame p50=${row.gpuFrameMs ? row.gpuFrameMs.p50.toFixed(2) : '—'} ` +
      `coupe=${ids.length} (${row.selection.source}) png=${capture ? 'oui' : 'non'}\n`,
  );
  return { row, captureFile };
}

/**
 * La mesure jouée dans la page, et ce que la carte graphique a signalé quand elle échoue.
 *
 * Une image perdue remonte ici avec sa pile d'appels et rien d'autre : la cause — erreur de
 * validation, appareil perdu — n'a été vue que dans la page. Le harnais la relit donc sur la page
 * avant de renvoyer l'échec, pour que le banc nomme la cause au lieu de la laisser deviner.
 */
async function runInPage(page, payload) {
  try {
    return await page.evaluate(
      async (o) => (await import(`${o.modulesUrl}${o.page}`)).measureView(o),
      payload,
    );
  } catch (error) {
    const incidents = await page.evaluate(() => globalThis.incidentsGpu ?? []).catch(() => []);
    if (!incidents.length) throw error;
    throw new Error(`${error.message}\nIncidents carte graphique :\n${incidents.join('\n')}`, {
      cause: error,
    });
  }
}
