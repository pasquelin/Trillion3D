import { createTessellation, type Tessellation } from './tessellation.ts'
import type { TessellationCapacity } from './uniform.ts'

/**
 * The tessellation a raster holds, kept as the settings ask (`wanted.ts`): made — its pipelines asked
 * off the frame, which waits on them — the first time `asked` names a capacity, made again when the
 * capacity moved, given back when none is asked: a scene that stopped drawing displaced surfaces,
 * or whose setting went off, keeps none of its buffers. Returns the one to hold.
 */
export function followTessellation(
  held: Tessellation | undefined,
  device: GPUDevice,
  work: GPUBuffer,
  asked: TessellationCapacity | undefined,
) {
  if (!asked) {
    held?.dispose()
    return undefined
  }
  if (held?.asked.candidate === asked.candidate && held.asked.visible === asked.visible) {
    held.ask()
    return held
  }
  held?.dispose()
  const made = createTessellation(device, work, asked)
  made.ask()
  return made
}
