/**
 * THE TRANSMISSION'S DRAW CONTEXT (`transmissionPass.ts`): its kernels — the clear, the
 * candidates, the pages, the bin, the number, the place and the resolve, beside the opaque
 * raster's chunk kernels with its own cull —, its lists and the groups it holds, which a grown
 * transmission keeps.
 */
import type { WebgpuBindIdentity } from '../webgpu/core/bindIdentity.ts'
import type { UniformSlots } from '../residency/pools.ts'
import type { vsmComputePipe } from './passKit.ts'
import type { VsmPerFrameSet } from './resources.ts'
import type { VsmRowBound } from './rowPageBound.ts'
import { vsmRenderCullWgsl } from './renderCullWgsl.ts'
import {
  vsmChunkContext,
  vsmChunkKernels,
  type VsmChunkKernels,
  type vsmChunkPasses,
} from './chunkKernels.ts'
import { vsmContextBytes, vsmReleaseContext, type VsmListName } from './chunkLists.ts'
import { vsmTransmissionPipes } from './transmissionPipes.ts'
import { TRANSMISSION_LABEL, type VsmTransmission } from './transmissionMade.ts'
import type { ChunkLists, ChunkTables } from './transmissionBin.ts'

type Pipe = ReturnType<typeof vsmComputePipe>

export interface VsmTransmissionContext extends VsmChunkKernels {
  device: GPUDevice
  clear: Pipe
  candidates: Pipe
  pages: Pipe
  bin: Pipe
  number: Pipe
  place: Pipe
  resolve: Pipe
  headers: Pipe
  /** The groups over one transmission's buffers (`transmissionGroups`), made again for another. */
  groups?: TransmissionGroups
  buffers: Partial<Record<VsmListName, GPUBuffer>>
  /** The chunks' parameter slots (`vsmChunkParamSlots`). */
  slots: UniformSlots
  /** Each chunk's parameter offset, made once for every frame (`vsmChunkPasses`). */
  passes: ReturnType<typeof vsmChunkPasses>
  /** What the chunk groups bound when made (`chunkGroups`). */
  bound: WebgpuBindIdentity
  /** The chunk groups over those alone, made again when one of them moved. */
  lists?: ChunkLists
  /** The chunk groups over the tables of a frame set (`res.current`, the two in turn) and
   *  `lists`, made again when one of them moved. */
  tables: VsmPerFrameSet<ChunkTables>
  /** Where the blended rows are, binned for the chunks' bound. */
  rowBound: VsmRowBound
}

/** The groups of the clear, the number, the place and the resolve of one transmission. */
interface TransmissionGroups {
  trans: VsmTransmission
  /** The clear's group of the VSM tables, by the frame's tables it binds. */
  clear0: VsmPerFrameSet<GPUBindGroup>
  clear1: GPUBindGroup
  number: GPUBindGroup
  place: GPUBindGroup
  resolve: GPUBindGroup
}

/** Bytes the draw context of `trans` holds on the device: its lists. */
export function vsmTransmissionContextBytes(trans: VsmTransmission) {
  return trans.context ? vsmContextBytes(trans.context) : 0
}

/** Frees the draw context of `trans`, which a grown transmission keeps (`grownFrom`). */
export function releaseVsmTransmission(trans: VsmTransmission) {
  if (trans.context) vsmReleaseContext(trans.context)
  trans.context = undefined
}

/** The draw context of `trans` on `device`: the one it holds, or made for another device. */
export function vsmTransmissionContext(
  trans: VsmTransmission,
  device: GPUDevice,
): VsmTransmissionContext {
  const existing = trans.context
  if (existing && existing.device === device) return existing
  const { layout } = trans
  const ctx: VsmTransmissionContext = {
    device,
    ...vsmTransmissionPipes(device, layout),
    ...vsmChunkKernels(
      device,
      layout,
      TRANSMISSION_LABEL,
      vsmRenderCullWgsl(layout, { marksDirty: false }),
    ),
    buffers: {},
    ...vsmChunkContext<ChunkTables>(TRANSMISSION_LABEL, device.limits, existing),
  }
  trans.context = ctx
  return ctx
}
