import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { encodePng } from '../../packages/sdk-node/png.mts';
import { distribution, machineLoad } from './rapport.mjs';
import { passesGpu } from './seriePasses.mjs';
import { poolGeometrie, reservoirs } from './serieReservoirs.mjs';

/** A series: one side, one view, one threshold. Writes its capture, returns its report row. */
export async function runSerie(ctx, page, side, view, pixelError, pose, captures, suffix = '') {
  const { MANIFEST, OUT, settings, lights, poses } = ctx;
  // The side's engine: `--moteur-<side>` distinguishes it from the campaign's, and that is how
  // the engine and the Three witness are measured in the same run.
  const ENGINE = side.engine;
  const captureFile = `${side.name}-${view}-e${pixelError}${suffix}.png`;
  const debut = machineLoad();
  const result = await runInPage(page, {
    sdkUrl: `/sdk/${side.name}/sdk-browser/index.js`,
    manifestUrl: side.manifestUrl ?? MANIFEST,
    backend: ENGINE.backend,
    engineId: ENGINE.id,
    autonomous: ENGINE.autonomous === true,
    // Modules the page imports by URL, and the witness: an engine that draws through Three does
    // not read the light store, so the host places the same lights in Three.
    modulesUrl: '/mesure/',
    witness: ENGINE.three === true,
    // The engine measurement page, and the source it loads when it is not the cache.
    page: ENGINE.page,
    gltfUrl: side.sourceUrl ?? null,
    pose,
    poses,
    captureFile,
    pixelError,
    frames: settings.frames,
    warmup: settings.warmup,
    // Memory reservoirs requested of the engine, and their in-session tuning; `null` = default.
    ...reservoirs(settings),
    instances: settings.instances,
    width: settings.width,
    height: settings.height,
    stageProfile: settings.stageProfile,
    // This side's diagnostic variant: it is what makes two sides two variants.
    variant: side.variant ?? null,
    // This side's screen-error metric (EXPERIMENT): `null` leaves ours.
    errorMetric: side.errorMetric ?? null,
    trace: settings.trace === true,
    bounce: settings.bounce,
    importedLights: settings.importedLights,
    profileFrames: settings.profileFrames,
    lights: lights ? lights.lights : [],
    moving: lights ? lights.moving : null,
    shadowBudgetMs: settings.shadowBudgetMs,
    shadowPages: settings.shadowPages,
    shadowDigest: settings.shadowDigest,
    // Textures read from the cache: only for an engine that reads the atlas, never the witness.
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
    await writeFile(join(OUT, captureFile), encodePng(capture.w, capture.h, capture.body, true));
  const ids = result.selection.ids;
  await writeFile(
    join(OUT, `${captureFile.replace(/\.png$/, '')}.coupe.txt`),
    ids.join('\n') + '\n',
  );
  const row = {
    cpuFrameMs: distribution(result.cpuFrameMs),
    cpuSelectMs: distribution(result.cpuSelectMs),
    moteur: ENGINE.id,
    // GPU envelope of a frame, when the page records it (WebGPU engine).
    gpuFrameMs: result.gpuFrameMs?.length ? distribution(result.gpuFrameMs) : null,
    // Wall time of a synchronised frame — render then GPU wait — when the page records it.
    imageSyncMs: result.syncFrameMs?.length ? distribution(result.syncFrameMs) : null,
    rafIntervalMs: result.rafIntervalMs?.length ? distribution(result.rafIntervalMs) : null,
    // Per-stage breakdown published by the engine: p50/p95, CPU and GPU separated.
    profilParEtape: result.stageProfile ?? null,
    // Each GPU pass and the blocks a published profile can name, p50/p95 over the
    // readings of the same loop as the profile; `null` with no reading.
    passesGpu: passesGpu(result.gpuPassSamples),
    // Preparation timed in the page, and bytes transferred on the network since, by file
    // kind; `null` for a dist older than these two readings.
    preparationMs: typeof result.preparationMs === 'number' ? result.preparationMs : null,
    // Frames rendered before the capture so the engine holds the pose; `null` if it holds none.
    imagesCalme: typeof result.imagesCalme === 'number' ? result.imagesCalme : null,
    // In-session reservoir tuning, as the engine reported it; `null` with no tuning.
    reglageVivant: result.reglageVivant ?? null,
    reseau: result.network ?? null,
    variante: side.variant ?? null,
    erreur: side.errorMetric ?? 'certifiee',
    selectedTriangles: metrics.selectedTriangles ?? null,
    uncoveredTriangles: metrics.uncoveredTriangles ?? null,
    // Triangles the recorded frame submitted to draw: the cut minus its hole, counted without
    // waiting for the GPU return. With the two neighbours, `selected − drawn − uncovered` must
    // be zero; `resume.md` makes it its "coverage" column. `null` outside this engine.
    drawnTriangles: metrics.drawnTriangles ?? null,
    // Triangles actually submitted to draw, recorded on the last measured frame — `imageDuReleve`
    // names it. `submittedTriangles` is the opaque pass, `totalSubmittedTriangles` adds the
    // transparent passes. `null` when the GPU count had not yet returned at that
    // moment: the GPU-chosen cut publishes its totals after the fact.
    submittedTriangles: metrics.submittedTriangles ?? null,
    totalSubmittedTriangles: metrics.totalSubmittedTriangles ?? null,
    imageDuReleve: settings.frames > 0 ? settings.frames - 1 : null,
    // Was the recorded frame held? A held frame re-encodes only a present: its submitted
    // triangles are zero because it drew nothing, not because nothing counted. `null` outside this engine.
    imageTenue: metrics.frameHeld ?? null,
    // Selection fallback: true when this engine had a GPU-chosen cut and
    // abandoned it for the CPU backup cut. `null` on an engine with no GPU cut.
    repliSelectionGpu: metrics.gpuSelectionFallback ?? null,
    // Contract occlusion counters, under their contract names. `image` names the frame they
    // describe — earlier on the GPU path. `null` = not counted.
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
    // Geometry memory published by the engine: bytes held by the page cache and the
    // vertex buffers. `null` when the engine does not publish it, never inferred.
    geometrieOctets: metrics.geometryAllocationBytes ?? null,
    budgetPages: {
      demande: settings.maxPages ?? null,
      residentes: metrics.residentPages ?? null,
      couvertureLimiteeParBudget: metrics.coverageBudgetLimited ?? null,
    },
    // The geometry pool as the engine held it: requested bytes, slots, what bounded it,
    // and pages the last frame wanted that it could not take. `null` = unpublished.
    poolGeometrie: poolGeometrie(metrics),
    // Compute-path governor reading: requested mode, module availability, and for
    // each batch operation the path actually run with both medians. `null` when the
    // measured dist predates the governor — unmeasured, not "JavaScript path".
    cheminCalcul: result.mathBatch ?? null,
    lampes: lights ? lights.resume : null,
    // Lights that came from the source file, as the engine declared them at open.
    lampesFichier: result.importedLights ?? null,
    // What the Three witness received from the store; `null` when this side does not draw through Three.
    lampesTemoin: result.lampesTemoin ?? null,
    // Shadow-atlas fingerprint, read once the queue is empty. Two runs that
    // differ only by `--ombres-pages` must yield the same: that is the proof that drawing
    // by pages is bit-identical to a full redraw.
    atlasOmbres: result.shadowAtlas ?? null,
    objetMobile: result.movingNode ?? null,
    charge: { debut, fin },
    png: capture ? captureFile : null,
    captureStatus: result.captureStatus,
    incidentsGpu: result.lost.length ? result.lost : null,
    // A DAG the compiler did not mount, spoken by the engine at open: `null` with none.
    avertissementsDag: result.avertissementsDag ?? null,
    // The engine's CPU bounds per named step (`cpu-timing`), each report stamped with the
    // measured frame it came on; `null` when the engine published none.
    bornesCpu: result.bornesCpu ?? null,
    canvas: result.size,
    metrics,
  };
  process.stdout.write(
    `${side.name} ${view} e${pixelError} : cpuFrame p50=${row.cpuFrameMs ? row.cpuFrameMs.p50.toFixed(2) : '—'} ` +
      `cpuSelect p50=${row.cpuSelectMs ? row.cpuSelectMs.p50.toFixed(2) : '—'} ` +
      `gpuFrame p50=${row.gpuFrameMs ? row.gpuFrameMs.p50.toFixed(2) : '—'} ` +
      `coupe=${ids.length} (${row.selection.source}) png=${capture ? 'yes' : 'no'}\n`,
  );
  return { row, captureFile };
}

/**
 * The measurement run in the page, and what the GPU reported when it fails.
 *
 * A lost frame comes up here with its call stack and nothing else: the cause — validation
 * error, lost device — was only seen in the page. The harness therefore rereads it on the page
 * before rethrowing, so the bench names the cause instead of leaving it to guess.
 */
async function runInPage(page, payload) {
  try {
    return await page.evaluate(async (o) => {
      const result = await (await import(`${o.modulesUrl}${o.page}`)).measureView(o);
      return { ...result, size: { ...result.size, dpr: devicePixelRatio } };
    }, payload);
  } catch (error) {
    const incidents = await page.evaluate(() => globalThis.incidentsGpu ?? []).catch(() => []);
    if (!incidents.length) throw error;
    throw new Error(`${error.message}\nGPU incidents:\n${incidents.join('\n')}`, {
      cause: error,
    });
  }
}
