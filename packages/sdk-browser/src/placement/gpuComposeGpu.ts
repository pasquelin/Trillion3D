/**
 * WHAT THE COMPOSITION HOLDS ON THE GPU (`gpuCompose.ts`): the links, the parents' worlds, the
 * previous worlds and the motion mode, the lists, the passes' parameters and their groups; and the
 * parameters of the passes that run a dispatch a range of the cut's worlds.
 */
import { resized } from '../../../math/src/sequence/resized.ts'
import { uniformStride } from '../residency/pools.ts'
import type { GpuSelection } from '../gpu/core/selection.ts'
import { MATRIX_DOUBLES } from './gpuComposeWgsl.ts'
import { heldGroup, type HeldGroup } from './composeGroups.ts'

/** The ranges the record holds between two passes: none. */
export const NO_RANGES: GpuSelection['worldRanges'] = []

export function createComposeGpu(device: GPUDevice, rootCount: number) {
  const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  const locals = device.createBuffer({
    label: 'Trillion3D composed locals',
    size: Math.max(1, rootCount) * MATRIX_DOUBLES * 8,
    usage: storage,
  })
  const parentOf = device.createBuffer({
    label: 'Trillion3D composed parents of',
    size: Math.max(1, rootCount) * 4,
    usage: storage,
  })
  const noMotion = device.createBuffer({ label: 'Trillion3D no motion', size: 64, usage: storage })
  const previous = device.createBuffer({
    label: 'Trillion3D composed previous worlds',
    size: Math.max(1, rootCount) * 64,
    usage: storage,
  })
  const motionMode = device.createBuffer({
    label: 'Trillion3D composed motion mode',
    size: 32,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const worldParams = device.createBuffer({
    label: 'Trillion3D compose world params',
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  return {
    locals,
    parentOf,
    parents: undefined as GPUBuffer | undefined,
    /** The roots pass's parameters, a uniform slot a range of the cut's worlds (`rangeParams`); the
     *  worlds pass's one block. */
    rootParams: rangeParams('Trillion3D compose params'),
    worldParams,
    noMotion,
    previous,
    motionMode,
    /** The composed roots and their rows as the passes read them (`sendList`). */
    rankList: undefined as GPUBuffer | undefined,
    rowList: undefined as GPUBuffer | undefined,
    /** The roots pass's group of each range of the cut's worlds, and the worlds pass's. */
    rootGroups: [] as HeldGroup[],
    worldsGroup: heldGroup(),
    /** What the groups' entries read live (`liveBuffer`), written at each pass's start: the cut's
     *  world ranges and the motion the roots bind. */
    frame: {
      ranges: NO_RANGES,
      motion: undefined as GPUBuffer | undefined,
    },
    dispose() {
      locals.destroy()
      parentOf.destroy()
      this.parents?.destroy()
      this.rootParams.buffer?.destroy()
      worldParams.destroy()
      noMotion.destroy()
      previous.destroy()
      motionMode.destroy()
      this.rankList?.destroy()
      this.rowList?.destroy()
    },
  }
}
export type ComposeGpu = ReturnType<typeof createComposeGpu>

/** A pass's parameters, a uniform slot (`uniformStride`) a range of the cut's worlds — the roots
 *  it runs over, the range, how many roots its list holds, whether it runs over every root —, sent
 *  when one of them moved: a frame that runs under the same ranges and lists sends none. The
 *  composition's passes, the root boxes pass (`rootBoxes.ts`) and the tree's leaves
 *  (`treeLeaves.ts`) keep theirs so. */
export const rangeParams = (label: string) => ({
  label,
  buffer: undefined as GPUBuffer | undefined,
  words: new Uint32Array(0),
  /** Words of `words` the buffer holds, -1 before any write. */
  written: -1,
})
type RangeParams = ReturnType<typeof rangeParams>

/** `params` written for `ranges`, `roots` roots and `listed` listed ones — every root when
 *  `whole` —, a slot of the device's stride (`uniformStride`) each. */
export function writeRangeParams(
  device: GPUDevice,
  params: RangeParams,
  ranges: readonly { first: number; count: number }[],
  roots: number,
  listed: number,
  whole = 0,
) {
  const stride = uniformStride(device.limits),
    slot = stride / 4,
    words = slot * ranges.length
  if (params.written === words) {
    let same = true
    for (let r = 0; r < ranges.length && same; r++) {
      const at = r * slot
      same =
        params.words[at] === roots &&
        params.words[at + 1] === ranges[r].first &&
        params.words[at + 2] === ranges[r].count &&
        params.words[at + 3] === listed &&
        params.words[at + 4] === whole
    }
    if (same) return
  }
  params.words = resized(params.words, words)
  if (!params.buffer || params.buffer.size < words * 4) {
    params.buffer?.destroy()
    params.buffer = device.createBuffer({
      label: params.label,
      size: Math.max(stride, words * 4),
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
  }
  for (let r = 0; r < ranges.length; r++) {
    const at = r * slot
    params.words[at] = roots
    params.words[at + 1] = ranges[r].first
    params.words[at + 2] = ranges[r].count
    params.words[at + 3] = listed
    params.words[at + 4] = whole
  }
  device.queue.writeBuffer(params.buffer, 0, params.words, 0, words)
  params.written = words
}
