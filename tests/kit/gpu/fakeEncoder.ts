import { simulateComputeDispatch, type ComputeBind } from './fakeCompute.ts'
import { createUsageScope } from './scopeRules.ts'
import type {
  FakeCopy,
  FakeDeviceOptions,
  FakeDispatch,
  FakeResolve,
  FakeTextureBufferCopy,
  FakeTextureCopy,
} from './fakeRecords.ts'
import {
  recordCommands,
  renderPass,
  type FakeDraw,
  type FakePass,
  type PassCommands,
} from './fakeRenderPass.ts'

/** What the encoders of one device record, in the order they were encoded. */
export type EncoderRecords = {
  draws: FakeDraw[]
  passes: FakePass[]
  /** Each compute pass, by its label, and every command it took, with its arguments. */
  computePasses: Array<{ label?: string; commands: PassCommands }>
  /** Every pass descriptor begun, render and compute, in order. */
  passDescriptors: Array<GPURenderPassDescriptor | GPUComputePassDescriptor | undefined>
  /** Every command that opens a GPU encoder of its own, in order: `compute <label>`, `render
   *  <label>`, `clear`, `copy`, `resolve` — what a test counts passes and their boundaries on. */
  commands: string[]
  dispatches: FakeDispatch[]
  copies: FakeCopy[]
  /** Each `clearBuffer`, its range as asked: `size` undefined to the buffer's end. */
  clears: Array<{ buffer: GPUBuffer; offset: number; size?: number }>
  textureCopies: FakeTextureCopy[]
  textureBufferCopies: FakeTextureBufferCopy[]
  resolves: FakeResolve[]
}

/**
 * The command encoders of `fakeDevice()`: each records what it encodes in `records`, copies and
 * clears move the buffers' bytes, and each compute dispatch runs its kernel's CPU double
 * (`fakeCompute.ts`) on the bound buffers — `packed` the DAG the selection reads when the session
 * uploads none, `kernel` a test's own double. `failVisPass` refuses the first visibility pass at its
 * beginning. Every pass is encoded under the device's usage scopes (`scopeRules.ts`); a `deferred`
 * device runs the work when its command buffer is submitted.
 */
export function createFakeCommandEncoderFactory(
  records: EncoderRecords,
  {
    packed,
    failVisPass = false,
    deferred = false,
    kernel,
  }: Pick<FakeDeviceOptions, 'packed' | 'failVisPass' | 'deferred' | 'kernel'>,
) {
  const { passDescriptors, commands, dispatches, copies, textureCopies } = records
  let computeBind: ComputeBind | undefined,
    computeOffsets: readonly number[] | undefined,
    computePipeline: { entryPoint: string } | undefined,
    visPassFails = failVisPass
  return () => {
    // The work the encoder holds until its command buffer is submitted, deferred.
    const ops: Array<() => void> = []
    const act = (op: () => void) => (deferred ? void ops.push(op) : op())
    return {
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
        const pass = passDescriptors.push(desc) - 1,
          taken: PassCommands = []
        records.computePasses.push({ label: desc?.label, commands: taken })
        commands.push(`compute ${desc?.label ?? ''}`)
        // Each dispatch is a usage scope: one reading its arguments from a buffer a group set binds
        // writable is refused, and so is one whose pipeline's groups are not all set, with its layouts.
        const scope = createUsageScope('compute')
        const run = (call: Omit<FakeDispatch, 'pass' | 'entryPoint'>) => {
          const entryPoint = computePipeline?.entryPoint ?? ''
          scope.dispatch(entryPoint)
          if (call.buffer) scope.indirect(call.buffer, entryPoint)
          dispatches.push({ pass, entryPoint, ...call })
          const [pipeline, bind, offsets] = [computePipeline, computeBind, computeOffsets]
          act(
            kernel?.(entryPoint, bind, offsets) ??
              (() => simulateComputeDispatch(pipeline, bind, packed, offsets)),
          )
        }
        return recordCommands(
          {
            setPipeline(next: { entryPoint: string }) {
              computePipeline = next
              scope.pipeline(next)
            },
            // Dynamic offsets count: plan expansion reads the uniform region of ITS pass, and two
            // passes follow each other in the same compute pass.
            setBindGroup(i: number, group: typeof computeBind, offsets?: readonly number[]) {
              computeBind = group
              computeOffsets = offsets
              scope.setBindGroup(i, group, offsets)
            },
            // Kernels that spread over the live-cluster list go through here: the double replays the
            // same kernel whichever path the GPU launches it on.
            dispatchWorkgroupsIndirect: (buffer: GPUBuffer, offset: number) =>
              run({ buffer, offset }),
            // A grid of no workgroup runs nothing, and the device warns ("DispatchWorkgroups with a
            // workgroup count of 0"): the engine encodes none, and the kit refuses it.
            dispatchWorkgroups(x: number, y = 1, z = 1) {
              if (!(x > 0 && y > 0 && z > 0))
                throw new Error(
                  `${computePipeline?.entryPoint}: a dispatch of ${x}×${y}×${z} workgroups`,
                )
              run({ direct: x, ...(y > 1 && { rows: y }) })
            },
            pushDebugGroup() {},
            popDebugGroup() {},
            end() {},
          },
          taken,
        )
      },
      clearBuffer(buffer: GPUBuffer & { data?: Uint8Array }, offset = 0, size?: number) {
        commands.push('clear')
        records.clears.push({ buffer, offset, size })
        act(() =>
          buffer.data?.fill(0, offset, size === undefined ? buffer.data.length : offset + size),
        )
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
        if (source && target)
          act(() => target.set(source.subarray(fromOffset, fromOffset + size), toOffset))
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
      finish: () => (deferred ? { ops } : {}),
    }
  }
}
