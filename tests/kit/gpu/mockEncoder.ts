import type { PackedDag } from '../../../packages/sdk-browser/src/gpu/dag/selection.ts'
import { simulateComputeDispatch, type ComputeBind } from './mockCompute.ts'
import { createUsageScope } from './usageScope.ts'

export type MockDraw = {
  vertexCount: number
  instanceCount?: number
  firstInstance?: number
  bindOffset?: number
  instanceBuffer?: unknown
  slotOffsetsBuffer?: unknown
  indirect?: boolean
  entryPoint?: string
  fragment?: string
  /** The blend of the pipeline's first colour target, as it was made. */
  blend?: GPUBlendState
}
export type MockPass = {
  label?: string
  colorLoad?: string
  colorClear?: GPUColor
  depthLoad?: string
  colorCount: number
  formats: string[]
}

export function createMockCommandEncoderFactory(inputs: {
  draws: MockDraw[]
  passes: MockPass[]
  /** Every command that opens a GPU encoder of its own, in order: `compute <label>`, `render
   *  <label>`, `clear`, `copy` — what a test counts passes and their boundaries on. */
  commands: string[]
  computes: string[]
  imageCopies: unknown[]
  /** The usage of each buffer-to-buffer copy's destination, in order. */
  copyUsages: number[]
  packed?: PackedDag
  failVisPass: boolean
}) {
  const { draws, passes, commands, computes, imageCopies, copyUsages, packed, failVisPass } = inputs
  let currentRenderEntry = '',
    currentFragment = '',
    currentBlend: GPUBlendState | undefined
  let currentBind: unknown,
    computeBind: ComputeBind | undefined,
    computeOffsets: readonly number[] | undefined,
    computePipeline: { entryPoint: string } | undefined,
    visPassFails = failVisPass
  return () => ({
    beginRenderPass: (desc?: {
      label?: string
      // An empty slot is `null`, as WebGPU takes it (the blend pass's share, #365).
      colorAttachments?: Array<{
        loadOp?: string
        clearValue?: GPUColor
        view?: { format?: string }
      } | null>
      depthStencilAttachment?: { depthLoadOp?: string }
    }) => {
      if (visPassFails && desc?.label === 'Trillion3D visibility primary') {
        visPassFails = false
        throw new Error('VIS_FAIL')
      }
      const colors = desc?.colorAttachments ?? []
      commands.push(`render ${desc?.label ?? ''}`)
      // The device's usage scope of the pass: an indirect buffer bound writable is refused.
      const scope = createUsageScope('render')
      passes.push({
        label: desc?.label,
        colorLoad: colors[0]?.loadOp,
        colorClear: colors[0]?.clearValue,
        depthLoad: desc?.depthStencilAttachment?.depthLoadOp,
        colorCount: colors.length,
        formats: colors.map((color) => color?.view?.format ?? ''),
      })
      return {
        setPipeline(pipeline: { entryPoint?: string; fragment?: string; blend?: GPUBlendState }) {
          currentRenderEntry = pipeline.entryPoint ?? ''
          currentFragment = pipeline.fragment ?? ''
          currentBlend = pipeline.blend
        },
        setBindGroup(i: number, group: unknown, offsets?: readonly number[]) {
          currentBind = group
          scope.setBindGroup(i, group, offsets)
        },
        setViewport() {},
        setScissorRect() {},
        setVertexBuffer() {},
        draw(vertexCount: number, instanceCount = 1, _firstVertex = 0, firstInstance = 0) {
          draws.push({
            vertexCount,
            instanceCount,
            firstInstance,
            entryPoint: currentRenderEntry,
            fragment: currentFragment,
            ...(currentBlend && { blend: currentBlend }),
          })
          void currentBind
        },
        drawIndirect(buffer: { data?: Uint8Array }, offset: number) {
          scope.indirect(buffer, currentRenderEntry)
          const words = new Uint32Array(buffer.data!.buffer, buffer.data!.byteOffset + offset, 4)
          const entries = (
            currentBind as
              { entries?: Array<{ binding: number; resource: { offset?: number } }> } | undefined
          )?.entries
          const page = entries?.find((entry) => entry.binding === 2)
          const instances = entries?.find((entry) => entry.binding === 8),
            offsets = entries?.find((entry) => entry.binding === 9)
          draws.push({
            vertexCount: words[0],
            instanceCount: words[1],
            firstInstance: words[3],
            bindOffset: page?.resource?.offset ?? 0,
            instanceBuffer: instances?.resource,
            slotOffsetsBuffer: offsets?.resource,
            indirect: true,
            entryPoint: currentRenderEntry,
          })
        },
        end: () => scope.end(),
      }
    },
    beginComputePass: (desc?: { label?: string }) => {
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
        end() {},
      }
    },
    clearBuffer(buffer: { data?: Uint8Array }, offset = 0, size?: number) {
      commands.push('clear')
      buffer.data?.fill(0, offset, size === undefined ? buffer.data.length : offset + size)
    },
    copyBufferToBuffer(
      src: { data?: Uint8Array },
      s: number,
      dst: { data?: Uint8Array; usage?: number },
      d: number,
      size: number,
    ) {
      commands.push('copy')
      copyUsages.push(dst.usage ?? 0)
      if (src.data && dst.data) dst.data.set(src.data.subarray(s, s + size), d)
    },
    copyTextureToBuffer(...args: unknown[]) {
      commands.push('copy')
      imageCopies.push(args)
    },
    copyTextureToTexture() {
      commands.push('copy')
    },
    finish: () => ({}),
  })
}
