/**
 * WHAT THE COMPOSITION HOLDS ON THE GPU (`gpuCompose.ts`): the links, the parents' worlds, the
 * previous worlds and the motion mode, the lists, the passes' parameters and their groups.
 */
import { PACKED_MATRIX_WORDS } from '../../../math/src/float/splitDouble.ts'
import { heldGroup } from '../webgpu/core/bindIdentity.ts'
import { passParams } from '../gpu/core/passParams.ts'

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
  return {
    locals,
    parentOf,
    parents: undefined as GPUBuffer | undefined,
    /** The roots pass's parameters and the worlds pass's (`passParams`). */
    rootParams: passParams('Trillion3D compose params'),
    worldParams: passParams('Trillion3D compose world params'),
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
      this.worldParams.buffer?.destroy()
      noMotion.destroy()
      previous.destroy()
      motionMode.destroy()
      this.rankList?.destroy()
      this.rowList?.destroy()
    },
  }
}
export type ComposeGpu = ReturnType<typeof createComposeGpu>
