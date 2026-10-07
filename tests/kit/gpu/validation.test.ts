// The kit's devices validate as WebGPU does (`validation.ts`): each rule refuses the call a real
// device refuses — by its name — and lets the valid twin through, on `fakeDevice` and `mockGpu`
// alike. The first case is the device loss a unit test once missed: an sRGB view of a storage
// texture that inherits the texture's usage, storage binding included.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from './fakeDevice.ts'
import { mockGpu } from './mockGpu.ts'

const T = () => GPUTextureUsage,
  B = () => GPUBufferUsage

/** A storage texture viewed in sRGB, as a material mip chain is (`texture/mips.ts`). */
const chain = (device: GPUDevice, mipLevelCount = 1) =>
  device.createTexture({
    size: [4, 4],
    format: 'rgba8unorm',
    viewFormats: ['rgba8unorm-srgb'],
    mipLevelCount,
    usage: T().STORAGE_BINDING | T().TEXTURE_BINDING,
  })

test('an sRGB view of a storage texture names its usage: inherited, storage binding is refused', () => {
  for (const device of [fakeDevice().device, mockGpu().device]) {
    const texture = chain(device)
    assert.throws(
      () => texture.createView({ format: 'rgba8unorm-srgb' }),
      /includes StorageBinding, incompatible with the format/,
    )
    texture.createView({ format: 'rgba8unorm-srgb', usage: T().TEXTURE_BINDING })
    texture.createView()
  }
})

test('a texture holds a usage its format takes, sRGB twins as views, a chain its size allows', () => {
  const { device } = fakeDevice()
  const make = (d: Partial<GPUTextureDescriptor>) =>
    device.createTexture({ size: [4, 4], format: 'rgba8unorm', usage: T().TEXTURE_BINDING, ...d })
  const storage = T().STORAGE_BINDING
  assert.throws(() => make({ format: 'rgba8unorm-srgb', usage: storage }), /StorageBinding/)
  assert.throws(() => make({ format: 'depth32float', usage: storage }), /StorageBinding/)
  assert.throws(() => make({ format: 'rgba8snorm', usage: T().RENDER_ATTACHMENT }), /RenderAtt/)
  assert.throws(() => make({ viewFormats: ['bgra8unorm'] }), /by more than -srgb/)
  assert.throws(() => make({ mipLevelCount: 4 }), /past the full chain \(3\)/)
  assert.throws(() => make({ size: [0, 4] }), /an empty side/)
  assert.throws(() => make({ usage: 0 }), /usage is 0/)
  make({ format: 'rgba8unorm', usage: storage | T().RENDER_ATTACHMENT, mipLevelCount: 3 })
  make({ format: 'depth32float', usage: T().RENDER_ATTACHMENT, viewFormats: [] })
  make({ viewFormats: ['rgba8unorm-srgb'] })
})

test("a view reads a format the texture lists, within the texture's usage, mips and layers", () => {
  const { device } = fakeDevice()
  const texture = chain(device, 3)
  assert.throws(() => texture.createView({ format: 'bgra8unorm' }), /nor one of its viewFormats/)
  assert.throws(
    () => texture.createView({ usage: T().RENDER_ATTACHMENT }),
    /not within the texture's/,
  )
  assert.throws(() => texture.createView({ baseMipLevel: 2, mipLevelCount: 2 }), /mips 2\+2 past/)
  texture.createView({ baseMipLevel: 2, mipLevelCount: 1 })
  const layered = device.createTexture({
    size: [4, 4, 2],
    format: 'r32float',
    usage: T().TEXTURE_BINDING,
  })
  assert.throws(() => layered.createView({ baseArrayLayer: 2 }), /layers 2\+0 past/)
  assert.throws(() => layered.createView({ dimension: 'cube' }), /layers 0\+6 past/)
  layered.createView({ dimension: '2d', baseArrayLayer: 1 })
})

test('a group binds each entry with a resource of its kind, usage, format and alignment', () => {
  const { device } = fakeDevice()
  const visibility = GPUShaderStage.COMPUTE
  const layout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility, buffer: { type: 'uniform' } },
      { binding: 1, visibility, storageTexture: { format: 'rgba8unorm' } },
      { binding: 2, visibility, texture: {} },
    ],
  })
  const uniform = device.createBuffer({ size: 512, usage: B().UNIFORM }),
    storage = device.createBuffer({ size: 512, usage: B().STORAGE })
  const texture = chain(device, 2)
  const level = texture.createView({ mipLevelCount: 1 }),
    srgb = texture.createView({ format: 'rgba8unorm-srgb', usage: T().TEXTURE_BINDING })
  const group = (buffer: GPUBufferBinding, stored: unknown, sampled: unknown) =>
    device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: buffer },
        { binding: 1, resource: stored as GPUTextureView },
        { binding: 2, resource: sampled as GPUTextureView },
      ],
    })
  assert.throws(() => group({ buffer: storage }, level, srgb), /lacks Uniform/)
  assert.throws(() => group({ buffer: uniform, offset: 128 }, level, srgb), /not aligned to 256/)
  assert.throws(() => group({ buffer: uniform }, srgb, srgb), /lacks StorageBinding/)
  assert.throws(() => group({ buffer: uniform }, texture.createView(), srgb), /of 2 mips/)
  assert.throws(() => group({ buffer: uniform }, level, device.createSampler()), /a sampler bound/)
  group({ buffer: uniform, offset: 256 }, level, srgb)
})

test('a buffer maps for copies alone, whole words when mapped at creation', () => {
  const { device } = fakeDevice()
  const read = B().MAP_READ
  assert.throws(() => device.createBuffer({ size: 8, usage: read | B().STORAGE }), /MapRead/)
  assert.throws(
    () => device.createBuffer({ size: 6, usage: B().STORAGE, mappedAtCreation: true }),
    /mappedAtCreation with a size of 6/,
  )
  device.createBuffer({ size: 8, usage: read | B().COPY_DST })
  device.createBuffer({ size: 8, usage: B().STORAGE, mappedAtCreation: true })
})

test('a copy reads COPY_SRC into COPY_DST, rows 256-byte aligned; a write moves whole words', () => {
  const { device } = mockGpu()
  const source = device.createBuffer({ size: 1024, usage: B().COPY_SRC }),
    target = device.createBuffer({ size: 1024, usage: B().COPY_DST | B().MAP_READ })
  const encoder = device.createCommandEncoder()
  assert.throws(() => encoder.copyBufferToBuffer(target, 0, source, 0, 16), /lacks CopySrc/)
  assert.throws(() => encoder.copyBufferToBuffer(source, 0, target, 0, 6), /size 6 is not/)
  encoder.copyBufferToBuffer(source, 0, target, 0, 16)
  const texture = device.createTexture({
    size: [8, 2],
    format: 'rgba8unorm',
    usage: T().COPY_SRC,
  })
  const copy = (bytesPerRow: number) =>
    encoder.copyTextureToBuffer({ texture }, { buffer: target, bytesPerRow }, [8, 2])
  assert.throws(() => copy(32), /bytesPerRow 32 is not a multiple of 256/)
  copy(256)
  assert.throws(() => device.queue.writeBuffer(target, 2, new Uint8Array(4)), /offset 2 is not/)
  assert.throws(() => device.queue.writeBuffer(target, 0, new Uint8Array(6)), /size 6 is not/)
  device.queue.writeBuffer(target, 0, new Uint8Array(8))
})

test('a pipeline layout binds no more a stage than the limits: their defaults, or those granted', () => {
  const stage = (kind: object, count: number, visibility: number) => ({
    entries: Array.from({ length: count }, (_, binding) => ({ binding, visibility, ...kind })),
  })
  const layout = (device: GPUDevice, kind: object, count: number, visibility: number) =>
    device.createPipelineLayout({
      bindGroupLayouts: [device.createBindGroupLayout(stage(kind, count, visibility))],
    })
  const storage = { buffer: { type: 'storage' } },
    stored = { storageTexture: { format: 'r32float' } },
    sampled = { texture: {} }
  const { device } = fakeDevice()
  const [compute, fragment] = [GPUShaderStage.COMPUTE, GPUShaderStage.FRAGMENT]
  assert.throws(() => layout(device, storage, 9, compute), /storage buffers in the Compute/)
  assert.throws(() => layout(device, stored, 5, fragment), /storage textures in the Fragment/)
  assert.throws(() => layout(device, sampled, 17, fragment), /sampled textures in the Fragment/)
  layout(device, storage, 8, compute)
  layout(device, stored, 4, fragment)
  layout(device, sampled, 16, fragment)
  const granted = fakeDevice({ limits: { maxStorageBuffersPerShaderStage: 10 } }).device
  layout(granted, storage, 10, compute)
  // Split over two groups, the count is the pipeline layout's.
  const half = device.createBindGroupLayout(stage(storage, 5, compute))
  assert.throws(
    () => device.createPipelineLayout({ bindGroupLayouts: [half, half] }),
    /storage buffers in the Compute stage \(10\)/,
  )
})
