// What each pass encodes, read from the calls the engine makes: workgroups and invocations of its
// dispatches, vertices of its draws, the bytes its attachments write, the bytes of the buffers and
// textures it binds (the most it can read). Facts of the encoding, not guesses of the GPU: the
// floors the report sets against a pass's time start from them.

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

/** Bytes a texel of `format` takes: the table of the formats the engine uses, 4 for the rest. */
const TEXEL: Record<string, number> = {
  r8unorm: 1,
  r8uint: 1,
  rg8unorm: 2,
  r16float: 2,
  r16uint: 2,
  depth16unorm: 2,
  rg16float: 4,
  rg16uint: 4,
  rgba8unorm: 4,
  'rgba8unorm-srgb': 4,
  bgra8unorm: 4,
  rgba8uint: 4,
  r32float: 4,
  r32uint: 4,
  r32sint: 4,
  rgb10a2unorm: 4,
  rg11b10ufloat: 4,
  depth32float: 4,
  depth24plus: 4,
  'depth24plus-stencil8': 4,
  rgba16float: 8,
  rgba16uint: 8,
  rg32float: 8,
  rg32uint: 8,
  rgba32float: 16,
  rgba32uint: 16,
}
const texel = (format: string) => TEXEL[format] ?? 4

type Texture = { px: number; bpp: number; bytes: number }
const textures = new WeakMap<object, Texture>()
const views = new WeakMap<object, object>()
const bound = new WeakMap<object, Map<object, number>>()
const codes = new WeakMap<object, string>()
const sizes = new WeakMap<object, number>()
/** The pipeline a compute pass last set, and what it bound, so a binding counts once. */
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
    const t = a && textures.get(views.get(a.view) ?? {})
    if (t && a.storeOp !== 'discard') total += t.px * t.bpp
  }
  const depth = descriptor?.depthStencilAttachment
  const t = depth && textures.get(views.get(depth.view) ?? {})
  if (t && depth.depthStoreOp !== 'discard') total += t.px * t.bpp
  return total
}

type Proto = Record<string, (...args: never[]) => unknown>
const after = (
  proto: Proto | undefined,
  name: string,
  hook: (self: object, args: never[], made: unknown) => void,
) => {
  const original = proto?.[name]
  if (!original) return
  proto![name] = function (this: object, ...args: never[]) {
    const made = original.apply(this, args)
    hook(this, args, made)
    return made
  }
}

/** The size of a texture descriptor, in pixels of its first layer and bytes of all of them. */
function describeTexture(d: GPUTextureDescriptor): Texture {
  const s = d.size as { width?: number; height?: number; depthOrArrayLayers?: number } & number[]
  const [w, h, layers] = Array.isArray(d.size)
    ? [s[0], s[1] ?? 1, s[2] ?? 1]
    : [s.width ?? 1, s.height ?? 1, s.depthOrArrayLayers ?? 1]
  const bpp = texel(d.format)
  const mips = (d.mipLevelCount ?? 1) > 1 ? 4 / 3 : 1
  return { px: w * h, bpp, bytes: w * h * layers * bpp * mips * (d.sampleCount ?? 1) }
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
    if (made instanceof Promise) void made.then((p) => sizes.set(p as object, size))
    else sizes.set(made as object, size)
  }
  after(device, 'createComputePipeline', pipeline)
  after(device, 'createComputePipelineAsync', pipeline)
  after(device, 'createBindGroup', (_s, [d], made) => {
    const resources = new Map<object, number>()
    for (const { resource } of (d as GPUBindGroupDescriptor).entries) {
      const r = resource as GPUBufferBinding & GPUTextureView & GPUSampler
      if (r.buffer) resources.set(r.buffer, r.size ?? r.buffer.size - (r.offset ?? 0))
      else {
        const t = textures.get(views.get(r) ?? {})
        if (t) resources.set(views.get(r)!, t.bytes)
      }
    }
    bound.set(made as object, resources)
  })
  for (const kind of ['GPUComputePassEncoder', 'GPURenderPassEncoder']) {
    const proto = g[kind].prototype
    const state = (self: object) =>
      passes.get(self) ?? (passes.set(self, { size: 1, seen: new Set() }), passes.get(self)!)
    after(
      proto,
      'setPipeline',
      (self, [p]) => void (state(self).size = sizes.get(p as object) ?? 1),
    )
    after(proto, 'setBindGroup', (self, [, group]) => {
      const work = lookup(self)
      if (!work) return
      const seen = state(self).seen
      for (const [resource, bytes] of bound.get(group as object) ?? []) {
        if (seen.has(resource)) continue
        seen.add(resource)
        work.boundBytes += bytes
      }
    })
    const direct = (name: string, count: (a: number[]) => [number, number]) =>
      after(proto, name, (self, args) => {
        const work = lookup(self)
        if (!work) return
        const [calls, items] = count(args as unknown as number[])
        work.calls += calls
        if (calls && kind === 'GPUComputePassEncoder') {
          work.groups += items
          work.invocations += items * state(self).size
        } else work.vertices += items
      })
    direct('dispatchWorkgroups', ([x, y = 1, z = 1]) => [x * y * z > 0 ? 1 : 0, x * y * z])
    direct('draw', ([v, i = 1]) => [v * i > 0 ? 1 : 0, v * i])
    direct('drawIndexed', ([v, i = 1]) => [v * i > 0 ? 1 : 0, v * i])
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
