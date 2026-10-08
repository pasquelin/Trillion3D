// What each pass encodes, read from the calls the engine makes: workgroups and invocations of its
// dispatches, vertices of its draws, the bytes its attachments write, the bytes of the buffers and
// textures it binds (the most it can read). Facts of the encoding, not guesses of the GPU: the
// floors the report sets against a pass's time start from them.

import { textureBytesOf } from '../../packages/sdk-browser/src/gpu/core/textureBytes.ts'
import { hookAfter as after, onMade, type Proto } from './hook.ts'

/** What one pass encoded. `calls`: direct dispatches and draws of some size. `indirect`: indirect
 *  ones, whose size only the GPU knows. `boundBytes`: every distinct buffer and texture it bound,
 *  whole — an upper bound of what it reads. `attachBytes`: its attachments' pixels it stores. */
export type PassWork = {
  calls: number
  indirect: number
  groups: number
  invocations: number
  vertices: number
  attachBytes: number
  boundBytes: number
}
export const emptyWork = (): PassWork => ({
  calls: 0,
  indirect: 0,
  groups: 0,
  invocations: 0,
  vertices: 0,
  attachBytes: 0,
  boundBytes: 0,
})

/** A texture's bytes whole (every level) and of its first level and layer, what an attachment stores. */
type Texture = { bytes: number; stored: number }
const textures = new WeakMap<object, Texture>()
const views = new WeakMap<object, object>()
const bound = new WeakMap<object, Map<object, number>>()
const codes = new WeakMap<object, string>()
const sizes = new WeakMap<object, number>()
/** The pipeline a compute pass last set, and what it bound, so a binding counts once. */
/** What a lookup that finds nothing is given: no allocation on a miss. */
const NONE = Object.freeze({})
const passes = new WeakMap<object, { size: number; seen: Set<object> }>()

/** The workgroup size of `entry` in WGSL `code`: its `@workgroup_size` product, 1 when none reads. */
function workgroupSize(code: string, entry: string | undefined) {
  const found = [
    ...code.matchAll(/@workgroup_size\(([^)]*)\)\s*(?:@\w+(?:\([^)]*\))?\s*)*fn\s+(\w+)/g),
  ]
  const mine = found.find((f) => f[2] === entry) ?? found[0]
  return mine ? mine[1].split(',').reduce((p, v) => p * (Number(v.trim()) || 1), 1) : 1
}

/** The bytes a render pass descriptor stores in its attachments: each attachment's pixels. */
export function attachmentBytes(descriptor: GPURenderPassDescriptor | undefined) {
  let total = 0
  for (const a of descriptor?.colorAttachments ?? []) {
    const t = a && textures.get(views.get(a.view) ?? NONE)
    if (t && a.storeOp !== 'discard') total += t.stored
  }
  const depth = descriptor?.depthStencilAttachment
  const t = depth && textures.get(views.get(depth.view) ?? NONE)
  if (t && depth.depthStoreOp !== 'discard') total += t.stored
  return total
}

/** A texture descriptor's sizes, by the engine's own byte counting (`textureBytesOf`). */
function describeTexture(d: GPUTextureDescriptor): Texture {
  const [width, height = 1] = Array.isArray(d.size)
    ? d.size
    : [(d.size as GPUExtent3DDict).width, (d.size as GPUExtent3DDict).height]
  return {
    bytes: textureBytesOf(d) ?? 0,
    stored:
      textureBytesOf({ size: [width, height, 1], format: d.format, sampleCount: d.sampleCount }) ??
      0,
  }
}

/** Hooks the creation and encoding calls of `g` (the WebGPU globals) so `lookup(pass)` — the
 *  record of a pass the timer follows — fills with what the pass encodes. */
export function installWorkHooks(
  g: Record<string, { prototype: Proto }>,
  lookup: (pass: object) => PassWork | undefined,
) {
  const device = g.GPUDevice.prototype
  after(device, 'createTexture', (_s, [d], made) =>
    textures.set(made as object, describeTexture(d as GPUTextureDescriptor)),
  )
  after(
    g.GPUTexture.prototype,
    'createView',
    (self, _a, made) => void views.set(made as object, self),
  )
  after(device, 'createShaderModule', (_s, [d], made) =>
    codes.set(made as object, (d as GPUShaderModuleDescriptor).code),
  )
  const pipeline = (_s: object, [d]: never[], made: unknown) => {
    const { module, entryPoint } = (d as GPUComputePipelineDescriptor).compute
    const size = workgroupSize(codes.get(module) ?? '', entryPoint)
    onMade(made, (p) => sizes.set(p, size))
  }
  after(device, 'createComputePipeline', pipeline)
  after(device, 'createComputePipelineAsync', pipeline)
  after(device, 'createBindGroup', (_s, [d], made) => {
    const resources = new Map<object, number>()
    for (const { resource } of (d as GPUBindGroupDescriptor).entries) {
      const r = resource as { buffer?: GPUBuffer; size?: number; offset?: number } & GPUTextureView
      if (r.buffer) resources.set(r.buffer, r.size ?? r.buffer.size - (r.offset ?? 0))
      else {
        const view = views.get(r)
        const t = view && textures.get(view)
        if (t) resources.set(view, t.bytes)
      }
    }
    bound.set(made as object, resources)
  })
  for (const kind of ['GPUComputePassEncoder', 'GPURenderPassEncoder']) {
    const proto = g[kind].prototype
    after(proto, 'setPipeline', (self, [pipeline]) => {
      if (!lookup(self)) return
      const state = passes.get(self)
      if (state) state.size = sizes.get(pipeline as object) ?? 1
      else passes.set(self, { size: sizes.get(pipeline as object) ?? 1, seen: new Set() })
    })
    after(proto, 'setBindGroup', (self, [, group]) => {
      const work = lookup(self)
      if (!work) return
      let state = passes.get(self)
      if (!state) passes.set(self, (state = { size: 1, seen: new Set() }))
      for (const [resource, bytes] of bound.get(group as object) ?? []) {
        if (state.seen.has(resource)) continue
        state.seen.add(resource)
        work.boundBytes += bytes
      }
    })
    const compute = kind === 'GPUComputePassEncoder'
    /** A direct call of `items` threads or vertices: counted when it has some. */
    const direct = (name: string, items: (a: number[]) => number) =>
      after(proto, name, (self, args) => {
        const work = lookup(self)
        if (!work) return
        const n = items(args as unknown as number[])
        if (!(n > 0)) return
        work.calls++
        if (compute) {
          work.groups += n
          work.invocations += n * (passes.get(self)?.size ?? 1)
        } else work.vertices += n
      })
    direct('dispatchWorkgroups', ([x, y = 1, z = 1]) => x * y * z)
    direct('draw', ([v, i = 1]) => v * i)
    direct('drawIndexed', ([v, i = 1]) => v * i)
    for (const name of ['dispatchWorkgroupsIndirect', 'drawIndirect', 'drawIndexedIndirect'])
      after(proto, name, (self) => {
        const work = lookup(self)
        if (work) work.indirect++
      })
  }
  after(g.GPURenderPassEncoder.prototype, 'executeBundles', (self, [bundles]) => {
    const work = lookup(self)
    if (work && (bundles as unknown[]).length) work.calls++
  })
}
