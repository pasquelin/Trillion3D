import type { PackedDag } from '../../../packages/sdk-browser/src/gpu/dag/selection.ts'
import { simulateComputeDispatch, type ComputeBind } from './mockCompute.ts'
import { createUsageScope } from './usageScope.ts'
import type {
  FakeCopy,
  FakeResolve,
  FakeTextureBufferCopy,
  FakeTextureCopy,
} from './fakeRecords.ts'
import { renderPass, type MockDraw, type MockPass } from './mockRenderPass.ts'

/** What the encoders of one device record, in the order they were encoded. */
export type EncoderRecords = {
  draws: MockDraw[]
  passes: MockPass[]
  /** Every pass descriptor begun, render and compute, in order. */
  passDescriptors: Array<GPURenderPassDescriptor | GPUComputePassDescriptor | undefined>
  /** Every command that opens a GPU encoder of its own, in order: `compute <label>`, `render
   *  <label>`, `clear`, `copy`, `resolve` — what a test counts passes and their boundaries on. */
  commands: string[]
  /** The entry point of each compute dispatch, in order. */
  computes: string[]
  copies: FakeCopy[]
  textureCopies: FakeTextureCopy[]
  textureBufferCopies: FakeTextureBufferCopy[]
  resolves: FakeResolve[]
}

/**
 * The command encoders of `fakeDevice()`: each records what it encodes in `records`, copies and
 * clears move the buffers' bytes, and each compute dispatch runs its kernel's CPU double
 * (`mockCompute.ts`) on the bound buffers — `packed` the DAG the selection reads when the session
 * uploads none. `failVisPass` refuses the first visibility pass at its beginning.
 */
export function createMockCommandEncoderFactory(
  records: EncoderRecords,
  { packed, failVisPass = false }: { packed?: PackedDag; failVisPass?: boolean },
) {
  const { passDescriptors, commands, computes, copies, textureCopies } = records
  let computeBind: ComputeBind | undefined,
    computeOffsets: readonly number[] | undefined,
    computePipeline: { entryPoint: string } | undefined,
    visPassFails = failVisPass
  return () => ({
    beginRenderPass: (desc?: GPURenderPassDescriptor) => {
      if (visPassFails && desc?.label === 'Trillion3D visibility primary') {
        visPassFails = false
        throw new Error('VIS_FAIL')
      }
      passDescriptors.push(desc)
      commands.push(`render ${desc?.label ?? ''}`)
      return renderPass(desc, records)
    },
    beginComputePass: (desc?: GPUComputePassDescriptor) => {
      passDescriptors.push(desc)
      commands.push(`compute ${desc?.label ?? ''}`)
      // Each dispatch is a usage scope: one reading its arguments from a buffer a group set binds
      // writable is refused.
      const scope = createUsageScope('compute')
      return {
        setPipeline(next: { entryPoint: string }) {
          computePipeline = next
        },
        // Dynamic offsets count: plan expansion reads the uniform region of ITS pass, and two passes
        // follow each other in the same compute pass.
        setBindGroup(i: number, group: typeof computeBind, offsets?: readonly number[]) {
          computeBind = group
          computeOffsets = offsets
          scope.setBindGroup(i, group, offsets)
        },
        // Kernels that spread over the live-cluster list go through here: the double replays the same
        // kernel whichever path the GPU launches it on.
        dispatchWorkgroupsIndirect(buffer: unknown) {
          scope.indirect(buffer, computePipeline?.entryPoint ?? '')
          simulateComputeDispatch(computePipeline, computeBind, computes, packed, computeOffsets)
        },
        // A grid of no workgroup runs nothing, and the device warns ("DispatchWorkgroups with a
        // workgroup count of 0"): the engine encodes none, and the kit refuses it.
        dispatchWorkgroups(x: number, y = 1, z = 1) {
          if (!(x > 0 && y > 0 && z > 0))
            throw new Error(
              `${computePipeline?.entryPoint}: a dispatch of ${x}×${y}×${z} workgroups`,
            )
          simulateComputeDispatch(computePipeline, computeBind, computes, packed, computeOffsets)
        },
        pushDebugGroup() {},
        popDebugGroup() {},
        end() {},
      }
    },
    clearBuffer(buffer: { data?: Uint8Array }, offset = 0, size?: number) {
      commands.push('clear')
      buffer.data?.fill(0, offset, size === undefined ? buffer.data.length : offset + size)
    },
    copyBufferToBuffer(
      from: GPUBuffer,
      fromOffset: number,
      to: GPUBuffer,
      toOffset: number,
      size: number,
    ) {
      commands.push('copy')
      copies.push({ from, fromOffset, to, toOffset, size })
      const source = (from as { data?: Uint8Array }).data,
        target = (to as { data?: Uint8Array }).data
      if (source && target) target.set(source.subarray(fromOffset, fromOffset + size), toOffset)
    },
    copyTextureToBuffer(
      source: GPUTexelCopyTextureInfo,
      destination: GPUTexelCopyBufferInfo,
      size: GPUExtent3D,
    ) {
      commands.push('copy')
      records.textureBufferCopies.push({ source, destination, size })
    },
    copyBufferToTexture(
      source: GPUTexelCopyBufferInfo,
      destination: GPUTexelCopyTextureInfo,
      size: GPUExtent3D,
    ) {
      commands.push('copy')
      records.textureBufferCopies.push({ source, destination, size })
    },
    copyTextureToTexture(
      from: GPUTexelCopyTextureInfo,
      to: GPUTexelCopyTextureInfo,
      size: GPUExtent3D,
    ) {
      commands.push('copy')
      textureCopies.push({ from, to, size })
    },
    resolveQuerySet(
      querySet: GPUQuerySet,
      first: number,
      count: number,
      destination: GPUBuffer,
      offset: number,
    ) {
      commands.push('resolve')
      records.resolves.push({ querySet, first, count, destination, offset })
    },
    finish: () => ({}),
  })
}
