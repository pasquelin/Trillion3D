// Une série de mesure : un côté, une vue, un seuil. Écrit la capture et la coupe, rend la ligne.
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pngFromRgba } from './serveur.mjs';
import { measureView } from './page.mjs';
import { distribution, machineLoad } from './rapport.mjs';

/** Une série : un côté, une vue, un seuil. Écrit sa capture, renvoie sa ligne de rapport. */
export async function runSerie(ctx, page, side, view, pixelError, pose, captures, suffix = '') {
  const { ENGINE, MANIFEST, OUT, settings, lights, poses } = ctx;
  const captureFile = `${side.name}-${view}-e${pixelError}${suffix}.png`;
  const debut = machineLoad();
  const result = await runInPage(page, {
    sdkUrl: `/sdk/${side.name}/sdk-browser/index.js`,
    manifestUrl: side.manifestUrl ?? MANIFEST,
    backend: ENGINE.backend,
    engineId: ENGINE.id,
    autonome: ENGINE.autonome === true,
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
    bounce: settings.bounce,
    importedLights: settings.importedLights,
    profileFrames: settings.profileFrames,
    lights: lights ? lights.lights : [],
    moving: lights ? lights.moving : null,
    shadowBudgetMs: settings.shadowBudgetMs,
    shadowPages: settings.shadowPages,
    shadowDigest: settings.shadowDigest,
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
    gpuFrameMs: settings.engine === 'webgpu' ? distribution(result.gpuFrameMs) : null,
    // Découpage par étape publié par le moteur : p50/p95, processeur et carte graphique séparés.
    profilParEtape: result.stageProfile ?? null,
    selectedTriangles: metrics.selectedTriangles ?? null,
    uncoveredTriangles: metrics.uncoveredTriangles ?? null,
    // Compteurs Hi-Z : le moteur ne les publie pas encore dans ses métriques. `null`, jamais déduit.
    hiZ: {
      tested: metrics.hiZTested ?? null,
      rejected: metrics.hiZRejected ?? null,
      beyond16Texels: metrics.hiZBeyond16Texels ?? null,
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
    lampes: lights ? lights.resume : null,
    // Les lampes venues du fichier source, telles que le moteur les a déclarées à l'ouverture.
    lampesFichier: result.importedLights ?? null,
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
    return await page.evaluate(measureView, payload);
  } catch (error) {
    const incidents = await page.evaluate(() => globalThis.incidentsGpu ?? []).catch(() => []);
    if (!incidents.length) throw error;
    throw new Error(`${error.message}\nIncidents carte graphique :\n${incidents.join('\n')}`, {
      cause: error,
    });
  }
}
