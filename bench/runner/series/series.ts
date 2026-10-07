import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from 'playwright'
import type { CameraPose } from '../../../packages/sdk-core/src/index.ts'
import { encodePng } from '../../../packages/sdk-node/src/cutout/png.mts'
import { distribution, machineLoad } from '../summary/summary.ts'
import { passesGpu } from './seriesPasses.ts'
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
  const start = machineLoad()
  const result = await runInPage(
    page,
    measurePayload(side, pixelError, pose, poses, captureFile, settings, lights, MANIFEST),
  )
  const end = machineLoad()
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
    cpuFrameMs: distribution(result.cpuFrameMs),
    engine: ENGINE.id,
    // GPU envelope of a frame, when the page records it (WebGPU engine).
    gpuFrameMs: result.gpuFrameMs?.length ? distribution(result.gpuFrameMs) : null,
    // Device idle between two neighbouring images (#1451), beside the GPU envelope of the same run:
    // the time the device stood unused before an image, which the envelope does not hold.
    gpuIdleMs: result.gpuIdleMs?.length ? distribution(result.gpuIdleMs) : null,
    // Wall time of a synchronised frame — render then GPU wait — when the page records it.
    imageSyncMs: result.syncFrameMs?.length ? distribution(result.syncFrameMs) : null,
    rafIntervalMs: result.rafIntervalMs?.length ? distribution(result.rafIntervalMs) : null,
    // Per-stage breakdown published by the engine: p50/p95, CPU and GPU separated.
    stageProfile: result.stageProfile ?? null,
    // Each GPU pass and the blocks a published profile can name, p50/p95 over the
    // readings of the same loop as the profile; `null` with no reading.
    passesGpu: passesGpu(result.gpuPassSamples),
    // Preparation timed in the page, and bytes transferred on the network since, by file
    // kind; `null` for a dist older than these two readings.
    preparationMs: typeof result.preparationMs === 'number' ? result.preparationMs : null,
    // Frames rendered before the capture so the engine holds the pose; `null` if it holds none.
    settleFrames: typeof result.settleFrames === 'number' ? result.settleFrames : null,
    // In-session reservoir tuning, as the engine reported it; `null` with no tuning.
    liveTuning: result.liveTuning ?? null,
    network: result.network ?? null,
    variant: side.variant ?? null,
    errorMetric: side.errorMetric ?? 'certifiee',
    selectedTriangles: metrics.selectedTriangles ?? null,
    uncoveredTriangles: metrics.uncoveredTriangles ?? null,
    // Triangles the recorded frame submitted to draw: the cut minus its hole, counted without
    // waiting for the GPU return. With the two neighbours, `selected − drawn − uncovered` must
    // be zero; `resume.md` makes it its "coverage" column. `null` outside this engine.
    drawnTriangles: metrics.drawnTriangles ?? null,
    // Triangles actually submitted to draw, recorded on the last measured frame — `recordedFrame`
    // names it. `submittedTriangles` is the opaque pass, `totalSubmittedTriangles` adds the
    // transparent passes. `null` when the GPU count had not yet returned: the GPU-chosen cut
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
    load: { start, end },
    png: capture ? captureFile : null,
    captureStatus: result.captureStatus,
    gpuIncidents: result.lost.length ? result.lost : null,
    // A DAG the compiler did not mount, spoken by the engine at open: `null` with none.
    dagWarnings: result.dagWarnings ?? null,
    // The engine's CPU bounds per named step over the profiled images; `null` where the path
    // keeps no row.
    cpuBounds: result.cpuBounds ?? null,
    canvas: result.size,
    metrics,
  }
  process.stdout.write(
    `${side.name} ${view} e${pixelError} : cpuFrame p50=${row.cpuFrameMs ? row.cpuFrameMs.p50.toFixed(2) : '—'} ` +
      `gpuFrame p50=${row.gpuFrameMs ? row.gpuFrameMs.p50.toFixed(2) : '—'} ` +
      `gpuIdle p50=${row.gpuIdleMs ? row.gpuIdleMs.p50.toFixed(2) : '—'} ` +
      `coupe=${ids.length} (${row.selection.source}) png=${capture ? 'yes' : 'no'}\n`,
  )
  return { row, captureFile }
}
