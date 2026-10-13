import { createUsageScope } from './usageScope.ts'
import { replayBundles } from './fakeBundles.ts'

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

/** A pipeline as the device makes it: its descriptor (`fakeDevice.ts`). */
type Pipeline = Partial<GPURenderPipelineDescriptor>
type Bound = { entries?: Array<{ binding: number; resource: { offset?: number } }> } | undefined

/**
 * A render pass of `fakeDevice()`, begun with `desc`: the pass is listed in `passes`, each draw in
 * `draws` with the entry points and blend of the pipeline set, an indirect draw read from its
 * buffer's bytes; its usage scope refuses an indirect buffer bound writable, and a bundle's
 * commands run in it, its usage scope included.
 */
export function renderPass(
  desc: GPURenderPassDescriptor | undefined,
  { passes, draws }: { passes: MockPass[]; draws: MockDraw[] },
) {
  // An empty slot is `null`, as WebGPU takes it (the blend pass's share).
  const colors = [...(desc?.colorAttachments ?? [])]
  const scope = createUsageScope('render')
  passes.push({
    label: desc?.label,
    colorLoad: colors[0]?.loadOp,
    colorClear: colors[0]?.clearValue as GPUColor | undefined,
    depthLoad: desc?.depthStencilAttachment?.depthLoadOp,
    colorCount: colors.length,
    formats: colors.map((color) => (color?.view as { format?: string } | undefined)?.format ?? ''),
  })
  let pipeline: Pipeline = {},
    bound: Bound
  const stage = () => ({
    entryPoint: pipeline.vertex?.entryPoint ?? '',
    fragment: pipeline.fragment?.entryPoint ?? '',
  })
  const blend = () => [...(pipeline.fragment?.targets ?? [])][0]?.blend
  const pass = {
    setPipeline(next: Pipeline) {
      pipeline = next
    },
    setBindGroup(i: number, group: unknown, offsets?: readonly number[]) {
      bound = group as Bound
      scope.setBindGroup(i, group, offsets)
    },
    setViewport() {},
    setScissorRect() {},
    setVertexBuffer() {},
    setIndexBuffer() {},
    pushDebugGroup() {},
    popDebugGroup() {},
    insertDebugMarker() {},
    draw(vertexCount: number, instanceCount = 1, _firstVertex = 0, firstInstance = 0) {
      const made = blend()
      draws.push({
        vertexCount,
        instanceCount,
        firstInstance,
        ...stage(),
        ...(made && { blend: made }),
      })
    },
    drawIndirect(buffer: { data?: Uint8Array }, offset: number) {
      scope.indirect(buffer, stage().entryPoint)
      const words = new Uint32Array(buffer.data!.buffer, buffer.data!.byteOffset + offset, 4)
      const entries = bound?.entries
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
        entryPoint: stage().entryPoint,
      })
    },
    executeBundles: (bundles: GPURenderBundle[]): void => replayBundles(pass, bundles),
    end: () => scope.end(),
  }
  return pass
}
