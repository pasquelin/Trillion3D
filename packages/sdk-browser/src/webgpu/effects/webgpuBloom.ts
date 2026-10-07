import type { Bloom } from '../../../../sdk-core/src/world/effect/bloom.ts'
import { createCheckedShaderModule } from '../../gpu/core/shaderModule.ts'
import { makeFullscreenPipeline } from '../../lighting/deferred/fullscreen.ts'
import { bloomBlend, bloomLevelBytes, bloomLevelSizes } from '../../effects/bloomFilter.ts'
import { BLOOM_WGSL } from './bloomWgsl.ts'
import { BLOOM_UNIFORM_BYTES, bloomLevelLayout } from '../../effects/bloomLevel.ts'
import { uniformStride } from '../../residency/pools.ts'
import { type FusedBlend, type WebgpuEffectKind } from './webgpuKinds.ts'

/** Label of every bloom pass: where it shows in a GPU capture. */
const BLOOM_PASS = 'Trillion3D bloom'
const FORMAT: GPUTextureFormat = 'rgba16float'
type Size = readonly [number, number]

/**
 * The WebGPU bloom (`bloomFilter.ts`): one `rgba16float` texture whose mip levels are the chain,
 * sized with the image (`resize`), and three programs. `encode` writes, into `output`, the image
 * `input` with its glow: the levels are filtered down, summed back up, and the first blended in —
 * or, with no `output`, that last blend left to the composition (`blend`).
 * Every bloom of the chain draws on the same levels, one after the other, but reads its own
 * uniform slots — the `nth` bloom the `nth` range of the buffer, at its dynamic offsets — since
 * every write of the buffer lands before the frame's first pass. Bind groups follow the targets
 * and the two history views the input alternates between: none is made per frame. A range is
 * written only when the size or a setting of its bloom changed.
 */
export async function createWebgpuBloom(device: GPUDevice): Promise<WebgpuEffectKind<Bloom>> {
  const visibility = GPUShaderStage.FRAGMENT
  const imageLayout = device.createBindGroupLayout({
    label: `${BLOOM_PASS} scene`,
    entries: [{ binding: 0, visibility, texture: { sampleType: 'unfilterable-float' } }],
  })
  const layouts = { level: bloomLevelLayout(device), scene: imageLayout }
  const module = await createCheckedShaderModule(device, BLOOM_WGSL, BLOOM_PASS)
  const add: GPUBlendComponent = { srcFactor: 'one', dstFactor: 'one', operation: 'add' }
  const [down, up, composite] = await Promise.all([
    makeFullscreenPipeline(device, module, layouts.level, 'down', [{ format: FORMAT }]),
    makeFullscreenPipeline(device, module, layouts.level, 'up', [
      { format: FORMAT, blend: { color: add, alpha: add } },
    ]),
    makeFullscreenPipeline(device, module, [layouts.level, layouts.scene], 'composite', [
      { format: FORMAT },
    ]),
  ])
  const sampler = device.createSampler({
    label: `${BLOOM_PASS} sampler`,
    magFilter: 'linear',
    minFilter: 'linear',
  }) // clamped to the edge, the default address mode
  // Bytes between two uniform slots: the device's dynamic-offset alignment.
  const stride = uniformStride(device.limits)
  let texture: GPUTexture | undefined,
    uniform: GPUBuffer | undefined,
    full: Size = [0, 0],
    sizes: Size[] = [],
    views: GPUTextureView[] = [],
    groups: GPUBindGroup[] = [],
    blends: FusedBlend[] = [],
    inputs = new WeakMap<GPUTextureView, { level: GPUBindGroup; scene: GPUBindGroup }>(),
    blend: FusedBlend | undefined,
    packed = new Float32Array(0),
    // The intensity and radius each bloom's range holds, NaN until it is written.
    held = new Float64Array(0),
    levelBytes = 0,
    passes = 0
  const levelGroup = (view: GPUTextureView) =>
    device.createBindGroup({
      layout: layouts.level,
      entries: [
        { binding: 0, resource: view },
        { binding: 1, resource: sampler },
        { binding: 2, resource: { buffer: uniform!, size: BLOOM_UNIFORM_BYTES } },
      ],
    })
  const inputGroups = (view: GPUTextureView) => {
    let bound = inputs.get(view)
    if (!bound) {
      const scene = device.createBindGroup({
        layout: layouts.scene,
        entries: [{ binding: 0, resource: view }],
      })
      inputs.set(view, (bound = { level: levelGroup(view), scene }))
    }
    return bound
  }
  /** The one descriptor and dynamic offset every pass begins with, rewritten in place: a pass
   *  reads them when it begins, so a frame allocates none of them (11 passes at 6 levels). A
   *  cleared level clears to zero, the default clear value. */
  const attachment = { storeOp: 'store' } as GPURenderPassColorAttachment
  const descriptor = { label: BLOOM_PASS, colorAttachments: [attachment] },
    offset = new Uint32Array(1)
  const release = () => {
    if (!passes) return // free already: nothing is allocated for it
    texture?.destroy()
    uniform?.destroy()
    texture = uniform = blend = undefined
    attachment.view = undefined as unknown as GPUTextureView // holds no freed view
    full = [0, 0]
    sizes = []
    views = []
    groups = []
    blends = []
    inputs = new WeakMap()
    levelBytes = passes = 0
  }
  /** Writes one uniform slot: inverse sizes written and read, radius, blend. */
  const slot = (index: number, out: Size, read: Size, radius: number, keep = 0, glow = 0) => {
    const base = (index * stride) / 4
    packed[base] = 1 / out[0]
    packed[base + 1] = 1 / out[1]
    packed[base + 2] = 1 / read[0]
    packed[base + 3] = 1 / read[1]
    packed[base + 4] = radius
    packed[base + 5] = keep
    packed[base + 6] = glow
  }
  /** Writes the `nth` bloom's range, its last slot at `last`, when its settings are not the ones
   *  it holds: a range depends only on them and on the size, whose change makes a new buffer. */
  const write = (nth: number, last: number, { intensity, radius }: Bloom) => {
    if (held[2 * nth] === intensity && held[2 * nth + 1] === radius) return
    held[2 * nth] = intensity
    held[2 * nth + 1] = radius
    const count = sizes.length,
      first = last + 1 - 2 * count,
      { keep, glow } = bloomBlend(intensity, count)
    for (let level = 0; level < count; level++)
      slot(first + level, sizes[level], level ? sizes[level - 1] : full, radius)
    for (let level = 0; level + 1 < count; level++)
      slot(first + count + level, sizes[level], sizes[level + 1], radius)
    slot(last, full, sizes[0], radius, keep, glow)
    const at = first * stride
    device.queue.writeBuffer(uniform!, at, packed, at / 4, (count * stride) / 2)
  }
  const draw = (
    encoder: GPUCommandEncoder,
    view: GPUTextureView,
    pipeline: GPURenderPipeline,
    group: GPUBindGroup,
    uniformSlot: number,
    scene?: GPUBindGroup,
  ) => {
    attachment.view = view
    attachment.loadOp = pipeline === up ? 'load' : 'clear'
    offset[0] = uniformSlot * stride
    const pass = encoder.beginRenderPass(descriptor)
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, group, offset, 0, 1)
    if (scene) pass.setBindGroup(1, scene)
    pass.draw(3)
    pass.end()
  }
  return {
    /** Bytes of the level chain as allocated; zero before the first `resize`. */
    get bytes() {
      return levelBytes
    },
    /** Sizes the levels for an image and the uniform for `count` blooms; none frees them. The
     *  uniform grows with the count, and never shrinks while the size holds. */
    resize(width: number, height: number, count: number) {
      if (!count) return release()
      if (width === full[0] && height === full[1] && count <= passes) return
      release()
      full = [width, height]
      passes = count
      sizes = bloomLevelSizes(width, height)
      if (!sizes.length) return
      levelBytes = bloomLevelBytes(width, height)
      texture = device.createTexture({
        label: `${BLOOM_PASS} levels`,
        size: { width: sizes[0][0], height: sizes[0][1] },
        mipLevelCount: sizes.length,
        format: FORMAT,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      })
      uniform = device.createBuffer({
        label: `${BLOOM_PASS} uniform`,
        size: passes * sizes.length * 2 * stride,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      })
      packed = new Float32Array(uniform.size / 4)
      held = new Float64Array(2 * passes).fill(Number.NaN)
      views = sizes.map((_, level) =>
        texture!.createView({ baseMipLevel: level, mipLevelCount: 1 }),
      )
      groups = views.map(levelGroup)
    },
    /** The last blend the last `encode` left to the composition. */
    get blend() {
      return blend
    },
    /** Draws `input` and its glow into `output`, the `nth` bloom of the chain: 2 × levels passes,
     *  one fewer with no `output`, none on an image too small to halve. The chain must be sized
     *  for it. */
    encode(encoder, bloom, nth, input, output) {
      const count = sizes.length
      blend = undefined
      if (!count) return 0
      const first = nth * 2 * count,
        last = first + 2 * count - 1
      write(nth, last, bloom)
      const source = inputGroups(input)
      for (let level = 0; level < count; level++)
        draw(encoder, views[level], down, level ? groups[level - 1] : source.level, first + level)
      for (let level = count - 2; level >= 0; level--)
        draw(encoder, views[level], up, groups[level + 1], first + count + level)
      if (!output) {
        // Made once per bloom and size, kept while the levels are: a frame allocates none.
        blend = blends[nth] ??= { group: groups[0], offset: last * stride }
        return 2 * count - 1
      }
      draw(encoder, output, composite, groups[0], last, source.scene)
      return 2 * count
    },
    dispose: () => release(),
  }
}
