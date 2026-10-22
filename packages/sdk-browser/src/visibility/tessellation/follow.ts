import { createTessellation, type Tessellation } from './tessellation.ts'
import type { TessellationCapacity } from './uniform.ts'

/** What a raster keeps of the tessellation: the instance, and the binning pipelines that leave it
 *  the displaced rows (`../raster/raster.ts`). */
type Held = {
  tessellation: Tessellation | undefined
  tessellatedBin(): readonly { ask(): unknown }[]
}

/**
 * Keeps the tessellation `held` has as the settings ask (`wanted.ts`): made — its pipelines, and
 * the binning's that leave it the displaced rows, asked off the frame, which waits on them — the
 * first time `asked` names a capacity, made again when the capacity moved — the patches the queue
 * and the lists hold, or the room of the displaced surfaces' records —, given back when none is
 * asked: a scene that stopped drawing displaced surfaces, or whose setting went off, keeps none of
 * its buffers.
 */
export function followTessellation(
  held: Held,
  device: GPUDevice,
  work: GPUBuffer,
  asked: TessellationCapacity | undefined,
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
    held.tessellation = createTessellation(device, work, asked)
    held.tessellation.ask()
  }
  for (const stage of held.tessellatedBin()) stage.ask()
}
