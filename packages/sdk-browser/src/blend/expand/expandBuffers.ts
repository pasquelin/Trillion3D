import { bitWords } from '../../../../math/src/scalar/integers.ts'
import { ORDER_UNI_WORDS } from '../order/orderWgsl.ts'
import { KEY_RECORD_WORDS } from '../keyLayout.ts'
import { orderFrameWords } from '../frame/frameHead.ts'
import { VERDICT_WORDS } from '../verdict/verdictLayout.ts'
import { orderStepCount, sortSize } from '../order/orderSteps.ts'
import { UNI_WORDS } from './expandUniform.ts'
import { VIEW_COUNT } from './expansionViews.ts'
import { uniformSlots } from '../../session/memory/pools.ts'
import { trackedBuffers } from '../../gpu/core/sizedBuffer.ts'

/** The scene's counts: its items, a pass's plan entries, the plan's and the expansion's work
 *  words. */
export type ExpandSizes = {
  items: number
  entries: number
  planWords: number
  scratchWords: number
}

/** The uniform slots of the order's steps and of the expansion's views (`VIEW_COUNT`), the device's
 *  `uniformStride` apart: the stride the plan's step words are laid at (`BlendState.uniformStride`,
 *  from the same device's limits). */
export const expandSlots = (device: GPUDevice, entries: number) => ({
  steps: uniformSlots(device.limits, orderStepCount(entries), ORDER_UNI_WORDS),
  pass: uniformSlots(device.limits, VIEW_COUNT, UNI_WORDS),
})
export type ExpandSlots = ReturnType<typeof expandSlots>

/** The kernels' scene buffers, each kept in `made`: what the frame writes, the verdict
 *  (`../verdict/verdictLayout.ts`) — cleared, copied to the readback —, then their own work memory — the
 *  expansion's scratch, the order's network and places. */
export function expandBuffers(
  device: GPUDevice,
  sizes: ExpandSizes,
  slots: ExpandSlots,
  made: GPUBuffer[],
) {
  const make = trackedBuffers(device, made, 16)
  const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    uniform = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    work = GPUBufferUsage.STORAGE,
    verdict = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
  return {
    uniforms: make('Trillion3D blend expand uniforms', slots.pass.bytes, uniform),
    plan: make('Trillion3D blend sorted plan', sizes.planWords * 4, storage),
    keep: make('Trillion3D blend frustum verdicts', bitWords(sizes.items) * 4, work),
    verdict: make('Trillion3D blend verdict', VERDICT_WORDS * 4, verdict),
    draws: make('Trillion3D blend draw descriptions', sizes.items * 16, storage),
    steps: make('Trillion3D blend order steps', slots.steps.bytes, uniform),
    keyed: make('Trillion3D blend key records', sizes.items * KEY_RECORD_WORDS * 4, storage),
    frame: make('Trillion3D blend order frame', orderFrameWords(sizes.entries, sizes.items) * 4, storage),
    scratch: make('Trillion3D blend expand scratch', sizes.scratchWords * 4, work),
    sorted: make('Trillion3D blend order network', sortSize(sizes.entries) * 16, work),
    placed: make('Trillion3D blend order places', sizes.entries * 4, work),
  }
}
export type ExpandBuffers = ReturnType<typeof expandBuffers>
