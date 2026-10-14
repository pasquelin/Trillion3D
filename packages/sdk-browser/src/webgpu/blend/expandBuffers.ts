import { bitWords } from '../../../../math/src/scalar/integers.ts'
import { ORDER_UNI_WORDS } from './orderBindings.ts'
import { KEY_RECORD_WORDS } from './keyLayout.ts'
import { orderFrameWords } from './frameHead.ts'
import { verdictWords } from './verdictLayout.ts'
import { WATER_ITEM_WORDS } from '../water/waterItems.ts'
import { orderStepCount, sortSize } from './orderSteps.ts'
import { EXPAND_PASSES } from './planLayout.ts'
import { UNI_WORDS } from './expandUniform.ts'
import { uniformSlots } from '../../residency/pools.ts'

/** The scene's counts: its items and water items, a pass's plan entries, the plan's and the
 *  expansion's work words. */
export type ExpandSizes = {
  items: number
  waters: number
  entries: number
  planWords: number
  scratchWords: number
}

/** The uniform slots of the order's steps and of the expansion's passes, the device's
 *  `uniformStride` apart: the stride the plan's step words are laid at (`BlendState.uniformStride`,
 *  from the same device's limits). */
export const expandSlots = (device: GPUDevice, entries: number) => ({
  steps: uniformSlots(device.limits, EXPAND_PASSES * orderStepCount(entries), ORDER_UNI_WORDS),
  passes: uniformSlots(device.limits, EXPAND_PASSES, UNI_WORDS),
})
export type ExpandSlots = ReturnType<typeof expandSlots>

/** The kernels' scene buffers, each kept in `made`: what the frame writes, the verdict the frame's
 *  kernels share (`verdictLayout.ts`) — cleared, indirect arguments, copied to the readback and to
 *  the front depth —, then their own work memory — the expansion's scratch, the order's network and
 *  places. */
export function expandBuffers(
  device: GPUDevice,
  sizes: ExpandSizes,
  slots: ExpandSlots,
  made: GPUBuffer[],
) {
  const make = (label: string, size: number, usage: number) => {
    const buffer = device.createBuffer({ label, size: Math.max(16, size), usage })
    made.push(buffer)
    return buffer
  }
  const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    uniform = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    work = GPUBufferUsage.STORAGE,
    verdict =
      GPUBufferUsage.STORAGE |
      GPUBufferUsage.INDIRECT |
      GPUBufferUsage.COPY_SRC |
      GPUBufferUsage.COPY_DST
  return {
    uniforms: make('Trillion3D blend expand uniforms', slots.passes.bytes, uniform),
    plan: make('Trillion3D blend sorted plan', sizes.planWords * 4, storage),
    keep: make('Trillion3D blend frustum verdicts', bitWords(sizes.items) * 4, work),
    verdict: make('Trillion3D blend verdict', verdictWords(sizes.waters) * 4, verdict),
    draws: make('Trillion3D blend draw descriptions', sizes.items * 16, storage),
    steps: make('Trillion3D blend order steps', slots.steps.bytes, uniform),
    keyed: make('Trillion3D blend key records', sizes.items * KEY_RECORD_WORDS * 4, storage),
    waterItems: make('Trillion3D water items', sizes.waters * WATER_ITEM_WORDS * 4, storage),
    frame: make(
      'Trillion3D blend order frame',
      orderFrameWords(sizes.items, sizes.entries) * 4,
      storage,
    ),
    scratch: make('Trillion3D blend expand scratch', sizes.scratchWords * 4, work),
    sorted: make('Trillion3D blend order network', sortSize(sizes.entries) * 16, work),
    placed: make('Trillion3D blend order places', sizes.entries * 4, work),
  }
}
export type ExpandBuffers = ReturnType<typeof expandBuffers>
