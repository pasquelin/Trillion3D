import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from 'playwright'
import type { CameraPose } from '../../../packages/sdk-core/src/index.ts'
import { encodePng } from '../../../packages/sdk-node/src/cutout/png.mts'
import { pageBudget, geometryPool } from './seriesPools.ts'
import { measurePayload, runInPage } from './seriesPage.ts'
import type { Side } from '../harness/sideOptions.ts'
import type { Capture } from '../../../tests/kit/server/staticServer.ts'
import type { Row, RunContext } from '../report/types.ts'

/** A series: one side, one view, one threshold. Writes its capture, returns its report row. */
export async function runSeries(
  ctx: RunContext,
  page: Page,
  side: Side,
  view: string,
  pixelError: number,
  pose: CameraPose,
  captures: Map<string, Capture>,
  suffix = '',
): Promise<{ row: Row; captureFile: string }> {
  const { MANIFEST, OUT, settings, lights, poses } = ctx
  // The side's engine (`--engine-<side>`): how the engine and the Three witness share one run.
  const ENGINE = side.engine
  const captureFile = `${side.name}-${view}-e${pixelError}${suffix}.png`
  const result = await runInPage(
    page,
    measurePayload(side, pixelError, pose, poses, captureFile, settings, lights, MANIFEST),
  )
  if ('error' in result) throw new Error(`${side.name} ${view} e${pixelError} : ${result.error}`)
  const metrics = result.metrics
  const capture = captures.get(captureFile)
  if (capture)
    await writeFile(join(OUT, captureFile), encodePng(capture.w, capture.h, capture.body, true))
  const ids = result.selection.ids
  await writeFile(
    join(OUT, `${captureFile.replace(/\.png$/, '')}.coupe.txt`),
    ids.join('\n') + '\n',
  )
  const row = {
    engine: ENGINE.id,
    // Frames rendered before the capture so the engine holds the pose; `null` if it holds none.
    settleFrames: typeof result.settleFrames === 'number' ? result.settleFrames : null,
    // In-session reservoir tuning, as the engine reported it; `null` with no tuning.
    liveTuning: result.liveTuning ?? null,
    // Bytes transferred on the network since the page opened, by file kind.
    network: result.network ?? null,
    variant: side.variant ?? null,
    selectedTriangles: metrics.selectedTriangles ?? null,
    uncoveredTriangles: metrics.uncoveredTriangles ?? null,
    // Triangles the recorded frame submitted to draw: the cut minus its hole, counted without
    // waiting for the GPU return. With the two neighbours, `selected − drawn − uncovered` must
    // be zero; `resume.md` makes it its "coverage" column. `null` outside this engine.
    drawnTriangles: metrics.drawnTriangles ?? null,
    // Triangles actually submitted to draw, recorded on the last measured frame — `recordedFrame`
    // names it. `submittedTriangles` is the opaque pass, `totalSubmittedTriangles` adds the
    // transparent passes. `null` when the GPU count has not returned: the GPU-chosen cut
    // publishes its totals after the fact.
    submittedTriangles: metrics.submittedTriangles ?? null,
    totalSubmittedTriangles: metrics.totalSubmittedTriangles ?? null,
    recordedFrame: settings.frames > 0 ? settings.frames - 1 : null,
    // Was the recorded frame held? A held frame re-encodes only a present: its submitted
    // triangles are zero because it drew nothing, not because nothing counted. `null` outside this engine.
    frameHeld: metrics.frameHeld ?? null,
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
      count: ids.length,
    },
    // Geometry memory published by the engine: bytes held by the page cache and the
    // vertex buffers. `null` when the engine does not publish it, never inferred.
    geometryBytes: metrics.geometryAllocationBytes ?? null,
    pageBudget: pageBudget(metrics, settings.maxPages),
    // The geometry pool as the engine held it: requested bytes, slots, what bounded it,
    // and pages the last frame wanted that it could not take. `null` = unpublished.
    geometryPool: geometryPool(metrics),
    // Compute-path governor reading: requested mode, module availability, and for
    // each batch operation the path actually run with both medians. `null` when the
    // measured dist predates the governor — unmeasured, not "JavaScript path".
    mathBatch: result.mathBatch ?? null,
    lights: lights ? lights.resume : null,
    // Lights that came from the source file, as the engine declared them at open.
    importedLights: result.importedLights ?? null,
    // What the Three witness received from the store; `null` when this side does not draw through Three.
    witnessLights: result.witnessLights ?? null,
    movingNode: result.movingNode ?? null,
    png: capture ? captureFile : null,
    captureStatus: result.captureStatus,
    gpuIncidents: result.lost.length ? result.lost : null,
    // A DAG the compiler did not mount, spoken by the engine at open: `null` with none.
    dagWarnings: result.dagWarnings ?? null,
    canvas: result.size,
    metrics,
  }
  process.stdout.write(
    `${side.name} ${view} e${pixelError} : ` +
      `cut=${ids.length} (${row.selection.source}) png=${capture ? 'yes' : 'no'}\n`,
  )
  return { row, captureFile }
}
