// What each pass encodes, read from the calls the engine makes: workgroups and invocations of its
// dispatches, vertices of its draws, the bytes its attachments write, the bytes of the buffers and
// textures it binds (the most it can read). Facts of the encoding, not guesses of the GPU: the
// floors the report sets against a pass's time start from them.

import { textureBytesOf } from '../../packages/sdk-browser/src/gpu/core/textureBytes.ts'
import { hookAfter as after, onMade, type Proto } from './hook.ts'

/** What one pass encoded. `calls`: direct dispatches and draws of some size. `indirect`: indirect
 *  ones, whose size only the GPU knows. `unsized`: encodings whose size is not known at all —
 *  those, a render bundle, a workgroup size or a texture format the bench cannot read — so the
 *  floors of the pass are lower bounds only. `boundBytes`: every distinct buffer and texture it bound,
 *  whole — an upper bound of what it reads. `attachBytes`: its attachments' pixels it stores. */
export type PassWork = {
  calls: number
  indirect: number
  unsized: number
  groups: number
  invocations: number
  vertices: number
  attachBytes: number
  boundBytes: number
}
export const emptyWork = (): PassWork => ({
  calls: 0,
  indirect: 0,
  unsized: 0,
  groups: 0,
  invocations: 0,
  vertices: 0,
  attachBytes: 0,
  boundBytes: 0,
})

/** A texture: its bytes whole (every level), and what `viewed` needs to size a level of it. */
type Texture = {
  bytes: number
  width: number
  height: number
  format: GPUTextureFormat
  samples: number
}
const textures = new WeakMap<object, Texture>()
/** A view: its texture, and the bytes of the one level and layer it shows — what an attachment stores. */
const views = new WeakMap<object, { owner: object; texture: Texture; stored: number }>()
const bound = new WeakMap<object, Map<object, number>>()
const codes = new WeakMap<object, string>()
const sizes = new WeakMap<object, number>()
/** The pipeline a compute pass last set, and what it bound, so a binding counts once. */
const passes = new WeakMap<object, { size: number; seen: Set<object> }>()

/** The workgroup size of `entry` in WGSL `code`: its `@workgroup_size` product, each side a number or
 *  a `const` / `override` the module gives a number; 0 when one cannot be read. */
function workgroupSize(code: string, entry: string | undefined) {
  const found = [
    ...code.matchAll(/@workgroup_size\(([^)]*)\)\s*(?:@\w+(?:\([^)]*\))?\s*)*fn\s+(\w+)/g),
  ]
  const mine = found.find((f) => f[2] === entry) ?? found[0]
  if (!mine) return 0
  const side = (token: string) => {
    const text = token.trim().replace(/u$/, '')
    if (/^\d+$/.test(text)) return Number(text)
    const named = new RegExp(`(?:const|override)\\s+${text}\\s*(?::\\s*\\w+)?\\s*=\\s*(\\d+)`).exec(
      code,
    )
    return named ? Number(named[1]) : 0
  }
  return mine[1].split(',').reduce((product, token) => product * side(token), 1)
}

/** The bytes a render pass descriptor stores in its attachments — each attachment's level, unless it
 *  is discarded or (depth) read only — and how many attachments are of a format the bench cannot size. */
export function attachmentBytes(descriptor: GPURenderPassDescriptor | undefined): [number, number] {
  let total = 0,
    unknown = 0
  const add = (view: GPUTextureView | GPUTexture) => {
    const stored = views.get(view)?.stored
    if (stored === undefined || Number.isNaN(stored)) unknown++
    else total += stored
  }
  for (const a of descriptor?.colorAttachments ?? []) if (a && a.storeOp !== 'discard') add(a.view)
  const depth = descriptor?.depthStencilAttachment
  if (depth && !depth.depthReadOnly && depth.depthStoreOp !== 'discard') add(depth.view)
  return [total, unknown]
}

/** A texture descriptor's sizes, bytes by the engine's own counting (`textureBytesOf`). */
function describeTexture(d: GPUTextureDescriptor): Texture {
  const [width, height = 1] = Array.isArray(d.size)
    ? d.size
    : [(d.size as GPUExtent3DDict).width, (d.size as GPUExtent3DDict).height]
  return {
    bytes: textureBytesOf(d) ?? Number.NaN,
    width,
    height,
    format: d.format,
    samples: d.sampleCount ?? 1,
  }
}

/** The level a view shows, one layer: its bytes. */
function describeView(owner: object, texture: Texture, d: GPUTextureViewDescriptor | undefined) {
  const level = d?.baseMipLevel ?? 0
  return {
    owner,
    texture,
    stored:
      textureBytesOf({
        size: [Math.max(1, texture.width >> level), Math.max(1, texture.height >> level), 1],
        format: texture.format,
        sampleCount: texture.samples,
      }) ?? Number.NaN,
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
  after(g.GPUTexture.prototype, 'createView', (self, [d], made) => {
    const texture = textures.get(self)
    if (texture)
      views.set(made as object, describeView(self, texture, d as GPUTextureViewDescriptor))
  })
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
        if (view) resources.set(view.owner, view.texture.bytes)
      }
    }
    bound.set(made as object, resources)
  })
  for (const kind of ['GPUComputePassEncoder', 'GPURenderPassEncoder']) {
    const proto = g[kind].prototype
    after(proto, 'setPipeline', (self, [pipeline]) => {
      if (!lookup(self)) return
      const state = passes.get(self)
      if (state) state.size = sizes.get(pipeline as object) ?? 0
      else passes.set(self, { size: sizes.get(pipeline as object) ?? 0, seen: new Set() })
    })
    after(proto, 'setBindGroup', (self, [, group]) => {
      const work = lookup(self)
      if (!work) return
      let state = passes.get(self)
      if (!state) passes.set(self, (state = { size: 0, seen: new Set() }))
      for (const [resource, bytes] of bound.get(group as object) ?? []) {
        if (state.seen.has(resource)) continue
        state.seen.add(resource)
        if (Number.isNaN(bytes)) work.unsized++
        else work.boundBytes += bytes
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
          const size = passes.get(self)?.size ?? 0
          work.groups += n
          work.invocations += n * size
          if (!size) work.unsized++
        } else work.vertices += n
      })
    direct('dispatchWorkgroups', ([x, y = 1, z = 1]) => x * y * z)
    direct('draw', ([v, i = 1]) => v * i)
    direct('drawIndexed', ([v, i = 1]) => v * i)
    for (const name of ['dispatchWorkgroupsIndirect', 'drawIndirect', 'drawIndexedIndirect'])
      after(proto, name, (self) => {
        const work = lookup(self)
        if (work) {
          work.indirect++
          work.unsized++
        }
      })
  }
  after(g.GPURenderPassEncoder.prototype, 'executeBundles', (self, [bundles]) => {
    const work = lookup(self)
    if (work && (bundles as unknown[]).length) {
      work.calls++
      work.unsized++
    }
  })
}
