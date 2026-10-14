/**
 * THE ROWS THE CPU NAMES, STALED ON THE GPU (`namedCastsWgsl.ts`): the rows whose shadow changed
 * where they stand (`nameCastRow`, `../pages/prepare/lightResources.ts`) sent as a list, and one
 * thread a row appending the box of the sphere the rows pass holds for it to the rows' shadow
 * changes (`castChanges.ts`) — encoded in the rows pass's compute pass, before its derivations write
 * the spheres again (`../../placement/rowWordsPass.ts`), whose room it shares (`reserveCasts`). No
 * sphere is made on
 * the CPU. A command buffer holding the kernel that is dropped takes the rows with it: every page
 * goes stale then (`namedCastsDropped`), never fewer.
 */
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { grownLength } from '../../../../math/src/sequence/resized.ts'
import { dispatchRows, WORKGROUP_THREADS } from '../../gpu/dispatch/grid.ts'
import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import { sequentialEntries } from '../../gpu/core/computeBindings.ts'
import { preparedComputePipeline } from '../../lighting/deferred/fullscreen.ts'
import { liveBuffer } from '../core/liveEntries.ts'
import { composeGroup, heldGroup } from '../../placement/composeGroups.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import { spheresMadeAnew, type CastChanges } from './castChanges.ts'
import { NAMED_CASTS_ENTRY, NAMED_CASTS_WGSL } from './namedCastsWgsl.ts'

const LABEL = 'Trillion3D named shadow changes'

/** The kernel, once a device, compiled off the thread (`askNamedCasts`). */
const kernel = oncePerDevice((device) =>
  preparedComputePipeline(device, {
    label: LABEL,
    layout: 'auto',
    compute: {
      module: device.createShaderModule({ label: LABEL, code: NAMED_CASTS_WGSL }),
      entryPoint: NAMED_CASTS_ENTRY,
    },
  }),
)

/** Asks the kernel at a frame's entry, with the rows pass's (`askRowWords`). */
export const askNamedCasts = (device: GPUDevice) => kernel(device).ask()

/** The rows named, sent — their count first —; a list made again when they outgrow it. */
function sendNamed(device: GPUDevice, named: CastChanges['named']) {
  const bytes = (named.count + 1) * 4
  if (!named.buffer || named.buffer.size < bytes) {
    named.buffer?.destroy()
    named.buffer = device.createBuffer({
      label: LABEL,
      size: grownLength(named.buffer ? named.buffer.size : 0, bytes),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
  }
  device.queue.writeBuffer(named.buffer, 0, named.rows, 0, named.count + 1)
}

/**
 * The rows named since the last pass, staled into `pass` — the rows pass's, before its dispatches —
 * from the spheres the lights bind (`castsBound`, whose room `reserveCasts` gave them), the list
 * then emptied. `encoder` holds the pass: dropped, it stales every page (`namedCastsDropped`).
 */
export function encodeNamedCasts(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  pass: GPUComputePassEncoder,
) {
  const casts = rt.lights.casts!,
    named = casts.named
  if (!named.count) return
  sendNamed(device, named)
  const pipeline = kernel(device).get(),
    held = (named.group ??= heldGroup())
  held.identity.entries[0] ??= sequentialEntries([
    liveBuffer(() => named.buffer),
    liveBuffer(() => rt.lights.spheres?.buffer),
    liveBuffer(() => rt.lights.mobilityRows),
    liveBuffer(() => rt.lights.casts?.buffer),
  ])
  composeGroup(device, held, pipeline)
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, held.group!)
  dispatchRows(pass, ceilDiv(named.count, WORKGROUP_THREADS))
  rt.run.gpuComputeDispatches++
  named.count = named.rows[0] = 0
  named.encodedInto = encoder
}

/** The command buffer `dropped` never ran: the rows it named for their shadow are lost, and every
 *  page goes stale once (`spheresMadeAnew`), never one fewer. */
export function namedCastsDropped(
  lights: { casts?: CastChanges; changes: Parameters<typeof spheresMadeAnew>[0]['changes'] },
  dropped: GPUCommandEncoder,
) {
  if (!lights.casts || lights.casts.named.encodedInto !== dropped) return
  lights.casts.named.encodedInto = undefined
  spheresMadeAnew(lights)
}
