import { createUsageScope } from './scopeRules.ts'
import { replayBundles } from './fakeBundles.ts'

/** One draw a render pass recorded: its pass (its index in `passDescriptors`), the pipeline and the
 *  groups set when it ran, its counts, and the buffer and byte offset an indirect one reads. */
export type MockDraw = {
  pass: number
  pipeline: Pipeline
  groups: unknown[]
  vertexCount: number
  instanceCount?: number
  firstVertex?: number
  firstInstance?: number
  bindOffset?: number
  instanceBuffer?: unknown
  slotOffsetsBuffer?: unknown
  indirect?: boolean
  buffer?: unknown
  offset?: number
  entryPoint?: string
  fragment?: string
  /** The blend of the pipeline's first colour target, as it was made. */
  blend?: GPUBlendState
}
/** One render pass, as it began — its attachments copied, since a frame rewrites its descriptors
 *  in place; an empty colour slot is `null` — and every command it took since, in order, with its
 *  arguments (a bundle's among them, after `executeBundles`; `end` last once it ended). */
export type MockPass = {
  label?: string
  colors: Array<GPURenderPassColorAttachment | null>
  depth?: GPURenderPassDepthStencilAttachment
  /** Each colour target's view format. */
  formats: string[]
  commands: PassCommands
}

/** A pass's commands, each in `commands` with its arguments as it is taken, then run. */
export type PassCommands = Array<[string, unknown[]]>

/** `pass` with each of its commands recorded in `commands` as it is taken, then run. */
export function recordCommands<P extends Record<string, (...args: never[]) => unknown>>(
  pass: P,
  commands: PassCommands,
) {
  const target = pass as Record<string, (...args: never[]) => unknown>
  for (const [name, run] of Object.entries(pass))
    target[name] = (...args: never[]) => {
      commands.push([name, args])
      return run(...args)
    }
  return pass
}

/** A pipeline as the device makes it: its descriptor (`fakeDevice.ts`). */
type Pipeline = Partial<GPURenderPipelineDescriptor>
type Bound = { entries?: Array<{ binding: number; resource: { offset?: number } }> } | undefined

/**
 * A render pass of `fakeDevice()`, begun with `desc` as the last of `passDescriptors`: the pass is
 * listed in `passes`, each draw in `draws` with the pipeline and groups set, an indirect draw read
 * from its buffer's bytes; its usage scope refuses an indirect buffer bound writable, and a
 * bundle's commands run in it, its usage scope included.
 */
export function renderPass(
  desc: GPURenderPassDescriptor | undefined,
  {
    passes,
    draws,
    passDescriptors,
  }: { passes: MockPass[]; draws: MockDraw[]; passDescriptors: unknown[] },
) {
  const at = passDescriptors.length - 1
  // An empty slot is `null`, as WebGPU takes it (the blend pass's share).
  const colors = [...(desc?.colorAttachments ?? [])].map((color) => (color ? { ...color } : null))
  const depth = desc?.depthStencilAttachment
  const scope = createUsageScope('render')
  const record: MockPass = {
    label: desc?.label,
    colors,
    ...(depth && { depth: { ...depth } }),
    formats: colors.map((color) => (color?.view as { format?: string } | undefined)?.format ?? ''),
    commands: [],
  }
  passes.push(record)
  let pipeline: Pipeline = {},
    bound: Bound
  const groups: unknown[] = []
  const stage = () => ({
    pass: at,
    pipeline,
    groups: [...groups],
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
      groups[i] = group
      scope.setBindGroup(i, group, offsets)
    },
    setViewport() {},
    setScissorRect() {},
    setVertexBuffer() {},
    setIndexBuffer() {},
    pushDebugGroup() {},
    popDebugGroup() {},
    insertDebugMarker() {},
    draw(vertexCount: number, instanceCount = 1, firstVertex = 0, firstInstance = 0) {
      const made = blend()
      draws.push({
        vertexCount,
        instanceCount,
        firstVertex,
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
        buffer,
        offset,
        ...stage(),
      })
    },
    executeBundles: (bundles: GPURenderBundle[]): void => replayBundles(pass, bundles),
    end: () => scope.end(),
  }
  return recordCommands(pass, record.commands)
}
