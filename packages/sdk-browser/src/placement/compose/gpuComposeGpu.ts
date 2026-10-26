/**
 * WHAT THE COMPOSITION HOLDS ON THE GPU (`gpuCompose.ts`): the links, the parents' worlds, the
 * list, the passes' parameters and their groups.
 */
import { PACKED_MATRIX_WORDS } from '../../../../math/src/float/splitDouble.ts'
import { heldGroup } from '../../gpu/bind/bindIdentity.ts'
import { passParams } from '../../gpu/core/passParams.ts'

/** The list's label, made and sent by it (`sendWords`). */
export const FRAME_LIST = 'Trillion3D composed roots'

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
  // A word a root at most, made once with the tables: a list never outgrows them (`sendWords`
  // keeps it), and no group that binds it is made again for its length.
  const list = (label: string) =>
    device.createBuffer({ label, size: Math.max(4, rootCount) * 4, usage: storage })
  return {
    locals,
    parentOf,
    parents: undefined as GPUBuffer | undefined,
    /** The parameters the worlds and roots passes read alike (`passParams`). */
    params: passParams('Trillion3D compose params'),
    /** The list the passes read (`sendWords`): the frame's composed roots — the worlds, roots
     *  and root boxes passes'. */
    frameList: list(FRAME_LIST),
    /** The roots pass's group and the worlds pass's. */
    rootGroup: heldGroup(),
    worldsGroup: heldGroup(),
    /** What the roots group's entries read live (`liveBuffer`), written at the pass's start: the
     *  cut's worlds, the one table the roots are written into. */
    frame: { worlds: undefined as GPUTextureView | undefined },
    dispose() {
      locals.destroy()
      parentOf.destroy()
      this.parents?.destroy()
      this.params.buffer?.destroy()
      this.frameList.destroy()
    },
  }
}
export type ComposeGpu = ReturnType<typeof createComposeGpu>
