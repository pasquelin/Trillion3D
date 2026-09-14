// Une série de mesure : un côté, une vue, un seuil. Écrit la capture et la coupe, rend la ligne.
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pngFromRgba } from './serveur.mjs';
import { measureView } from './page.mjs';
import { distribution, machineLoad } from './rapport.mjs';

/** Une série : un côté, une vue, un seuil. Écrit sa capture, renvoie sa ligne de rapport. */
export async function runSerie(ctx, page, side, view, pixelError, pose, captures, suffix = '') {
  const { ENGINE, MANIFEST, OUT, settings } = ctx;
  const captureFile = `${side.name}-${view}-e${pixelError}${suffix}.png`;
  const debut = machineLoad();
  const result = await page.evaluate(measureView, {
    sdkUrl: `/sdk/${side.name}/sdk-browser/index.js`,
    manifestUrl: MANIFEST,
    backend: ENGINE.backend,
    engineId: ENGINE.id,
    pose,
    captureFile,
    pixelError,
    frames: settings.frames,
    warmup: settings.warmup,
    maxPages: settings.maxPages,
    width: settings.width,
    height: settings.height,
  });
  const fin = machineLoad();
  if (result.erreur) throw new Error(`${side.name} ${view} e${pixelError} : ${result.erreur}`);
  const metrics = result.metrics ?? {};
  const capture = captures.get(captureFile);
  if (capture)
    await writeFile(join(OUT, captureFile), pngFromRgba(capture.body, capture.w, capture.h));
  const ids = result.selection.ids;
  await writeFile(join(OUT, `${captureFile.replace(/\.png$/, '')}.coupe.txt`), ids.join('\n') + '\n');
  const row = {
    cpuFrameMs: distribution(result.cpuFrameMs),
    cpuSelectMs: distribution(result.cpuSelectMs),
    gpuFrameMs: settings.engine === 'webgpu' ? distribution(result.gpuFrameMs) : null,
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
      sha256: result.selection.source ? createHash('sha256').update(ids.join('\n')).digest('hex') : null,
      taille: ids.length,
    },
    budgetPages: {
      demande: settings.maxPages,
      residentes: metrics.residentPages ?? null,
      couvertureLimiteeParBudget: metrics.coverageBudgetLimited ?? null,
    },
    charge: { debut, fin },
    png: capture ? captureFile : null,
    captureStatus: result.captureStatus,
    contexteWebglPerdu: result.lost.length ? result.lost : null,
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
