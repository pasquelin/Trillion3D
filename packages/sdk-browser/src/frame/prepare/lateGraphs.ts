import { track } from '../../lighting/deferred/compileLedger.ts'
import { graphRastersOf, type GraphRasters } from '../../materials/graph/graphRasters.ts'
import { rigTemporalAgain } from '../../post/taa/prepare.ts'
import type { ShadeCensus } from '../../visibility/passes/shadeCensus.ts'
import { createVisModule } from '../../visibility/passes/shaders.ts'
import { cameraMasks } from '../../visibility/shader/maskSets.ts'
import { visibilityWpo } from '../../visibility/shader/wpoSets.ts'
import { isCancelled } from '../../session/engine/common.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { prepareRasterPipelines } from './visibilitySteps.ts'

/**
 * THE GRAPH OUTPUTS OF A SESSION THAT GREW. The cutouts and offsets the rasters evaluate are those of
 * the programs the session's surfaces wear (`WebgpuVisState.rasters`), held at its open; a surface
 * whose graph joined since — a material assigned, a graph edited — brings a program no module holds.
 * At the frame's entry that retakes the census, the programs it counts that the set lacks join it, and
 * the modules that hold the set are made again while the frames wait (`track`, `deviceAnswering`),
 * showing the previous image, the session not opened again:
 * - the visibility raster's module and its pipelines, the voxel slots' with them;
 * - the software raster, its tessellation with it (`ensureGpuRaster`, which sees the set moved);
 * - the shadow maps' rasters and tessellation, which follow the set they are handed;
 * - where an offset joined: the resolve's frame cache and the temporal pass, whose programs place the
 *   vertices of a pixel's triangle (its history starts again).
 * The classes of the resolve are asked after, over the set (`framePipelines.ts`); the transparent
 * pass takes the set when it builds its programs for the copies a session gains (`growth.ts`).
 */
export function followGraphRasters(rt: WebgpuPagesRuntime, device: GPUDevice, census: ShadeCensus) {
  const { vis } = rt,
    held = vis.rasters,
    next = graphRastersOf(census.surfaces, held)
  if (next === held) return
  vis.rasters = next
  rt.diag.engineDiagnostic(
    'material-graph-rasters-late',
    'A graph joined the session: the modules that hold its masks and offsets are made again',
    { pixelPrograms: next.pixelPrograms.length, offsets: next.offsets.length },
  )
  // One rebuild at a time: it takes the set as it stands when it begins a round, and rounds again
  // while it moved.
  if (!vis.rasterRebuild) {
    const rebuild = rebuildRasters(rt, device, held).finally(() => (vis.rasterRebuild = undefined))
    vis.rasterRebuild = rebuild
    track(device, rebuild, true, 'material graph rebuild')
  }
}

/** The modules made again over the set in place, until it stands still. */
async function rebuildRasters(rt: WebgpuPagesRuntime, device: GPUDevice, made: GraphRasters) {
  const { vis } = rt
  try {
    while (made !== vis.rasters) {
      const held = vis.rasters
      const visModule = await createVisModule(
        device,
        rt.context?.diagnosticGpuVariant,
        rt.setup.clipping,
        cameraMasks(held),
        visibilityWpo(held),
      )
      await prepareRasterPipelines(
        rt,
        device,
        { visModule, visBindGroupLayout: vis.visBindGroupLayout! },
        rt.context?.diagnosticGpuVariant,
      )
      if (held.offsets !== made.offsets) {
        await rigTemporalAgain(rt, device)
      }
      made = held
    }
    rt.run.gate.resourcesChanged()
  } catch (error) {
    if (!isCancelled(rt.signal)) rt.diag.diagnosticFailure('material-graph-rebuild-refused', error)
  }
}
