import type { TessellationLoss } from '../../../../sdk-core/src/contracts/metrics.ts'
import type { TessellationResources } from './resources.ts'
import type { TessellationCapacity } from './uniform.ts'

/**
 * THE CAPACITY GROWS ON A LOSS. The queue, the visible list, the windows (a share of the queue's size, `windowCapacity`) and the buffer of what the occlusion
 * test hid are sized by the settings (`tessellationMaxCandidatePatches`, `tessellationMaxVisiblePatches`); a scene that needs more loses patches in silence. The
 * losses are read back (`losses.ts`): one that came back doubles what the next image asks for, up to what the device lets the buffer be (`fitCapacity`), where it
 * stops. The other growths of the engine (`gpu/core/tableGrowth.ts`, `blend/growth.ts`, `frame/prepare/catalogueGrowth.ts`) make room for content a session gains, once
 * it is known: none reacts to a loss read back, so this one is its own. The settings stay the floor, and the growth is held for the session's device: an instance made again keeps what the
 * last one had to grow to.
 */
const grown = new WeakMap<GPUDevice, { candidate: number; visible: number }>()

/** The capacity the session grew to on `device`, none while it never lost a patch. */
const grownCapacity = (device: GPUDevice | undefined) => device && grown.get(device)

/** The capacity asked, raised to what the session grew to (`growCapacity`). */
export function withGrowth(device: GPUDevice | undefined, asked: TessellationCapacity) {
  const more = grownCapacity(device)
  if (more) {
    asked.candidate = Math.max(asked.candidate, more.candidate)
    asked.visible = Math.max(asked.visible, more.visible)
  }
  return asked
}

/**
 * A reading of the losses (`sample`): what the instance `resources` holds is doubled where a pool lost patches — the queue, the windows and the occlusion's
 * buffer all follow the queue's size, the visible list its own — as far as the device allows. Whether it grew; nothing grows without a loss, nor past
 * what the device holds.
 */
export function growCapacity(
  device: GPUDevice,
  resources: Pick<TessellationResources, 'capacity' | 'roomFor'>,
  sample: TessellationLoss,
) {
  const { capacity } = resources
  const queue = sample.queue + sample.windows + sample.occluded > 0,
    visible = sample.visible > 0
  if (!queue && !visible) return false
  const fitted = resources.roomFor(
    queue ? capacity.candidate * 2 : capacity.candidate,
    visible ? capacity.visible * 2 : capacity.visible,
  )
  if (fitted.candidate <= capacity.candidate && fitted.visible <= capacity.visible) return false
  const before = grown.get(device)
  grown.set(device, {
    candidate: Math.max(before?.candidate ?? 0, fitted.candidate),
    visible: Math.max(before?.visible ?? 0, fitted.visible),
  })
  return true
}
