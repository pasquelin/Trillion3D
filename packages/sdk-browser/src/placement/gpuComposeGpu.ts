/**
 * WHAT THE COMPOSITION HOLDS ON THE GPU (`gpuCompose.ts`): the links, the parents' worlds, the
 * previous worlds and the motion mode, the lists, the passes' parameters and their groups.
 */
import { MATRIX_VALUES } from '../../../math/src/batch/strides.ts'
import { PACKED_MATRIX_WORDS } from '../../../math/src/float/splitDouble.ts'
import { heldGroup } from '../webgpu/core/bindIdentity.ts'
import { passParams } from '../gpu/core/passParams.ts'

/** The lists' labels, made and sent by them (`sendWords`). */
export const FRAME_LIST = 'Trillion3D composed roots',
  MOTION_LIST = 'Trillion3D composed motion roots'

export function createComposeGpu(device: GPUDevice, rootCount: number) {
  const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  const locals = device.createBuffer({
    label: 'Trillion3D composed locals',
    size: Math.max(1, rootCount) * PACKED_MATRIX_WORDS * 4,
    usage: storage,
  })
  const parentOf = device.createBuffer({
    label: 'Trillion3D composed parents of',
    size: Math.max(1, rootCount) * 4,
    usage: storage,
  })
  const previous = device.createBuffer({
    label: 'Trillion3D composed previous worlds',
    size: Math.max(1, rootCount) * MATRIX_VALUES * 4,
    usage: storage,
  })
  // A word a root at most, made once with the tables: a list never outgrows them (`sendWords`
  // keeps it), and no group that binds it is made again for its length.
  const list = (label: string) =>
    device.createBuffer({ label, size: Math.max(4, rootCount) * 4, usage: storage })
  const motionMode = device.createBuffer({
    label: 'Trillion3D composed motion mode',
    size: 32,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  return {
    locals,
    parentOf,
    parents: undefined as GPUBuffer | undefined,
    /** The parameters the worlds and roots passes read alike, and the motion pass's
     *  (`passParams`). */
    params: passParams('Trillion3D compose params'),
    motionParams: passParams('Trillion3D compose motion params'),
    previous,
    motionMode,
    /** The lists the passes read (`sendWords`): the frame's composed roots — the worlds, roots
     *  and root boxes passes' —, the motion pass's roots and the rows pass's rows. */
    frameList: list(FRAME_LIST),
    motionList: list(MOTION_LIST),
    rowList: undefined as GPUBuffer | undefined,
    /** The roots pass's group, the worlds pass's and the motion pass's. */
    rootGroup: heldGroup(),
    worldsGroup: heldGroup(),
    motionGroup: heldGroup(),
    /** What the roots group's entries read live (`liveBuffer`), written at the pass's start: the
     *  cut's worlds, the one table the roots are written into. */
    frame: { worlds: undefined as GPUTextureView | undefined },
    dispose() {
      locals.destroy()
      parentOf.destroy()
      this.parents?.destroy()
      this.params.buffer?.destroy()
      this.motionParams.buffer?.destroy()
      previous.destroy()
      motionMode.destroy()
      this.frameList.destroy()
      this.motionList.destroy()
      this.rowList?.destroy()
    },
  }
}
export type ComposeGpu = ReturnType<typeof createComposeGpu>
