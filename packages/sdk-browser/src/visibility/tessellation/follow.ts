import { createTessellation, type Tessellation } from './tessellation.ts'
import { NO_RASTERS, type GraphRasters } from '../../materials/graph/graphRasters.ts'
import type { TessellationCapacity } from './uniform.ts'

/** What a raster keeps of the tessellation: the instance (`../raster/raster.ts`). */
type Held = { tessellation: Tessellation | undefined }

/**
 * Keeps the tessellation `held` has as the settings ask (`wanted.ts`): made — its pipelines asked
 * off the frame, which waits on them — the
 * first time `asked` names a capacity, made again when the capacity moved — the patches the queue
 * and the lists hold, or the room of the displaced surfaces' records —, given back when none is
 * asked: a scene that stopped drawing displaced surfaces, or whose setting went off, keeps none of
 * its buffers.
 */
export function followTessellation(
  held: Held,
  device: GPUDevice,
  work: GPUBuffer,
  lists: () => GPUBuffer,
  asked: TessellationCapacity | undefined,
  clipping = false,
  rasters: GraphRasters = NO_RASTERS,
) {
  const was = held.tessellation
  if (!asked) {
    was?.dispose()
    held.tessellation = undefined
    return
  }
  if (
    was?.asked.candidate === asked.candidate &&
    was.asked.visible === asked.visible &&
    was.asked.records === asked.records
  )
    was.ask()
  else {
    was?.dispose()
    held.tessellation = createTessellation(device, work, lists, asked, clipping, rasters)
    held.tessellation.ask()
  }
}
