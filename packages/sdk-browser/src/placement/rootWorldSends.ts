/**
 * THE ROOTS' WORLDS AND LOCAL BOXES, SENT (`rootWorlds.ts`): the roots the running cut holds — the
 * session's, then those a growth appended into the cut's room before they join it
 * (`webgpuGrowth.ts`), at the ranks they will hold —, packed in doubles and written in runs; a root a
 * parent composes is the GPU's, never sent.
 */
import { packDoubles } from '../../../math/src/float/splitDouble.ts'
import { resized } from '../../../math/src/sequence/resized.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import { composedRoot } from './gpuComposeState.ts'

/** Words of a root's world, sixteen doubles; of its world box, six; of its local box, six doubles
 *  and whether it has one (`rootBoxesWgsl.ts`). */
export const ROOT_WORLD_WORDS = 32,
  ROOT_BOX_WORDS = 12,
  ROOT_LOCAL_WORDS = 14
/** Roots one write sends at most: the scratch a run is packed in stays this size. */
const RUN_ROOTS = 1024

/** The roots the running cut holds: the session's, then those it took in place, waiting to join. */
export const cutRoots = ({ layout, growth }: WebgpuPagesRuntime) =>
  layout.selectionRoots.length + (growth?.appended ?? 0)

/** The root at `rank` of those the running cut holds (`cutRoots`). */
function rootAt({ layout, growth }: WebgpuPagesRuntime, rank: number) {
  const session = layout.selectionRoots
  return rank < session.length ? session[rank] : growth!.roots[rank - session.length]
}

/** Roots `[from, to]`, none composed, their worlds packed and sent in one write. */
function sendRun(rt: WebgpuPagesRuntime, device: GPUDevice, from: number, to: number) {
  const held = rt.rootWorlds!,
    count = to - from + 1
  held.worldWords = resized(held.worldWords, count * ROOT_WORLD_WORDS)
  for (let k = 0; k < count; k++)
    packDoubles(held.worldWords, k * ROOT_WORLD_WORDS, rootAt(rt, from + k).world.elements, 0, 16)
  const at = from * ROOT_WORLD_WORDS * 4
  device.queue.writeBuffer(held.worlds!, at, held.worldWords, 0, count * ROOT_WORLD_WORDS)
}

/** Roots `[from, to]` sent, the composed ones left to the GPU: runs of neighbours none composes,
 *  a run `RUN_ROOTS` roots at most. */
export function sendSpan(rt: WebgpuPagesRuntime, device: GPUDevice, from: number, to: number) {
  let first = -1
  for (let rank = from; rank <= to; rank++) {
    if (composedRoot(rt, rank)) {
      if (first >= 0) sendRun(rt, device, first, rank - 1)
      first = -1
      continue
    }
    if (first < 0) first = rank
    else if (rank - first === RUN_ROOTS) {
      sendRun(rt, device, first, rank - 1)
      first = rank
    }
  }
  if (first >= 0) sendRun(rt, device, first, to)
}

/** The local boxes of roots `[from, to)`, sent: a root's own, read and never written, and whether
 *  it has a world box at all — the root boxes pass carries the one by its world. */
export function sendLocals(rt: WebgpuPagesRuntime, device: GPUDevice, from: number, to: number) {
  const held = rt.rootWorlds!,
    count = to - from
  if (count <= 0) return
  held.localWords = resized(held.localWords, count * ROOT_LOCAL_WORDS)
  held.localWords.fill(0, 0, count * ROOT_LOCAL_WORDS)
  for (let k = 0; k < count; k++) {
    const { localBox, worldBox } = rootAt(rt, from + k)
    if (!localBox || !worldBox || !(localBox[3] >= localBox[0])) continue
    packDoubles(held.localWords, k * ROOT_LOCAL_WORDS, localBox, 0, 6)
    held.localWords[k * ROOT_LOCAL_WORDS + 12] = 1
  }
  const at = from * ROOT_LOCAL_WORDS * 4
  device.queue.writeBuffer(held.locals!, at, held.localWords, 0, count * ROOT_LOCAL_WORDS)
}
