/**
 * WHAT THE COMPOSITION HOLDS ON THE GPU (`gpuCompose.ts`): the links, the parents' worlds, the
 * previous worlds and the motion mode, the lists, the passes' parameters and their groups.
 */
import { MATRIX_DOUBLES } from './gpuComposeWgsl.ts'
import { heldGroup } from './composeGroups.ts'

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
    /** The roots pass's parameters (`passParams`); the worlds pass's one block. */
    rootParams: passParams('Trillion3D compose params'),
    worldParams,
    noMotion,
    previous,
    motionMode,
    /** The composed roots and their rows as the passes read them (`sendList`). */
    rankList: undefined as GPUBuffer | undefined,
    rowList: undefined as GPUBuffer | undefined,
    /** The roots pass's group, and the worlds pass's. */
    rootGroup: heldGroup(),
    worldsGroup: heldGroup(),
    /** What the groups' entries read live (`liveBuffer`), written at each pass's start: the cut's
     *  worlds — the one table the roots are written into — and the motion the roots bind. */
    frame: {
      worlds: undefined as GPUTextureView | undefined,
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

/** A pass's parameters — the roots it runs over, how many roots its list holds, whether it runs
 *  over every root —, one uniform block sent when one of them moved: a frame that runs under the
 *  same lists sends none. The composition's roots pass, the root boxes pass (`rootBoxes.ts`) and
 *  the tree's leaves (`treeLeaves.ts`) keep theirs so. */
export const passParams = (label: string) => ({
  label,
  buffer: undefined as GPUBuffer | undefined,
  words: new Uint32Array(4),
  written: false,
})
type PassParams = ReturnType<typeof passParams>

/** Bytes of a pass's parameters (`passParams`). */
export const PASS_PARAM_BYTES = 16

/** `params` written for `roots` roots and `listed` listed ones — every root when `whole` —, made
 *  at its first write. */
export function writePassParams(
  device: GPUDevice,
  params: PassParams,
  roots: number,
  listed: number,
  whole = 0,
) {
  const { words } = params
  if (params.written && words[0] === roots && words[1] === listed && words[2] === whole) return
  words[0] = roots
  words[1] = listed
  words[2] = whole
  params.buffer ??= device.createBuffer({
    label: params.label,
    size: PASS_PARAM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(params.buffer, 0, words)
  params.written = true
}
