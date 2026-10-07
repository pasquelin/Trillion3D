import test from 'node:test'
import assert from 'node:assert/strict'
import { gpuDeviceLedgerOf, installGpuDeviceLedger } from './deviceLedger.ts'
import { textureBytesOf } from './textureBytes.ts'
import { namesNoSession, sessionHandle } from './sessionHandle.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'

test('a texture is counted over all its levels, layers and format', () => {
  const rgba = textureBytesOf({
    size: { width: 2048, height: 2048, depthOrArrayLayers: 3 },
    format: 'rgba8unorm',
    mipLevelCount: 12,
    usage: 0,
  })
  // 2048² × 4 bytes × (1 + 1/4 + … + 1/4¹¹) × 3 layers.
  let perLayer = 0
  for (let l = 0; l < 12; l++) perLayer += (2048 >> l) ** 2 * 4
  assert.equal(rgba, perLayer * 3)
  assert.equal(textureBytesOf({ size: [64, 32], format: 'depth32float', usage: 0 }), 64 * 32 * 4)
  // A BC7 block is sixteen bytes for sixteen texels: one byte per texel, rounded to the block.
  assert.equal(textureBytesOf({ size: [6, 6], format: 'bc7-rgba-unorm', usage: 0 }), 4 * 16)
  // The ETC2 family's pools, colour and two-channel, cost the same sixteen bytes a block.
  for (const format of ['etc2-rgba8unorm-srgb', 'eac-rg11unorm'] as const)
    assert.equal(textureBytesOf({ size: [6, 6], format, usage: 0 }), 4 * 16, format)
  // A volume also divides its depth at each level; an array does not.
  assert.equal(
    textureBytesOf({
      size: [4, 4, 4],
      format: 'r8unorm',
      mipLevelCount: 2,
      dimension: '3d',
      usage: 0,
    }),
    64 + 8,
  )
  assert.equal(
    textureBytesOf({ size: [4, 4, 4], format: 'r8unorm', mipLevelCount: 2, usage: 0 }),
    64 + 16,
  )
  assert.equal(textureBytesOf({ size: [1, 1], format: 'r8snorm', usage: 0 }), null)
})

test('the ledger sees each allocation, returns it on destroy and installs once', () => {
  const { device, destroyed } = fakeDevice()
  const ledger = installGpuDeviceLedger(device)
  assert.equal(installGpuDeviceLedger(device), ledger)
  assert.equal(gpuDeviceLedgerOf(device), ledger)
  const buffer = device.createBuffer({
    label: 'Trillion3D pages',
    size: 1000,
    usage: GPUBufferUsage.STORAGE,
  })
  device.createBuffer({ label: 'Trillion3D pages', size: 24, usage: GPUBufferUsage.STORAGE })
  const texture = device.createTexture({
    label: 'Trillion3D display color',
    size: [16, 16],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING,
  })
  device.createBuffer({ size: 8, usage: GPUBufferUsage.STORAGE })
  let snapshot = ledger.snapshot()
  assert.equal(snapshot.bytes, 1024 + 1024 + 8)
  assert.deepEqual(Object.keys(snapshot.byLabel), [
    'Trillion3D pages',
    'Trillion3D display color',
    'unlabeled',
  ])
  assert.equal(snapshot.live, 4)
  assert.equal(snapshot.unknownFormats, 0)
  buffer.destroy()
  texture.destroy()
  texture.destroy()
  assert.deepEqual(
    destroyed.map((resource) => resource.label ?? ''),
    ['Trillion3D pages', 'Trillion3D display color', 'Trillion3D display color'],
  )
  snapshot = ledger.snapshot()
  assert.equal(snapshot.bytes, 24 + 8)
  assert.equal(snapshot.live, 2)
})

test('a format outside the table counts zero bytes and declares itself, never an estimate', () => {
  const { device } = fakeDevice()
  const ledger = installGpuDeviceLedger(device)
  device.createTexture({ size: [8, 8], format: 'r8snorm', usage: GPUTextureUsage.TEXTURE_BINDING })
  assert.deepEqual(ledger.snapshot(), {
    bytes: 0,
    byLabel: { unlabeled: 0 },
    unknownFormats: 1,
    live: 1,
  })
  assert.equal(gpuDeviceLedgerOf(undefined), undefined)
})

test('a budget refusal names the allocation it refused, by the label the engine wrote', () => {
  const gpu = fakeDevice()
  const handle = sessionHandle(gpu.device, '@t3d:7')
  const ledger = installGpuDeviceLedger(handle.device, { limit: () => 100 })
  handle.device.createBuffer({ label: 'vsm.pageTable', size: 90, usage: GPUBufferUsage.STORAGE })
  const refused = 'GPU_BUDGET_EXCEEDED: requested=20, label=vsm.physicalPool1.0, held=90, limit=100'
  assert.throws(
    () =>
      handle.device.createBuffer({
        label: 'vsm.physicalPool1.0',
        size: 20,
        usage: GPUBufferUsage.STORAGE,
      }),
    { message: refused },
    "the session's tag is joined below the ledger: the label is the engine's own",
  )
  assert.equal(ledger.refusal?.message, refused)
  assert.equal(gpu.buffers.length, 1, 'the refused buffer never reaches the device')
  // A texture is named the same way, and an allocation without a label says so.
  assert.throws(
    () =>
      handle.device.createTexture({
        label: 'vsm.depth',
        size: [4, 4],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING,
      }),
    { message: 'GPU_BUDGET_EXCEEDED: requested=64, label=vsm.depth, held=90, limit=100' },
  )
  assert.throws(() => handle.device.createBuffer({ size: 11, usage: GPUBufferUsage.STORAGE }), {
    message: 'GPU_BUDGET_EXCEEDED: requested=11, label=unlabeled, held=90, limit=100',
  })
  assert.equal(gpu.textures.length, 0)
  handle.release()
})

test('a shared allocation refused by a session budget carries its own label to that budget', () => {
  const gpu = fakeDevice()
  const base = installGpuDeviceLedger(gpu.device, { counts: namesNoSession })
  const handle = sessionHandle(gpu.device, '@t3d:8')
  const session = installGpuDeviceLedger(handle.device, { base, limit: () => 100 })
  handle.device.createBuffer({ label: 'main view', size: 90, usage: GPUBufferUsage.STORAGE })
  const refused = 'GPU_BUDGET_EXCEEDED: requested=20, label=shared cache, held=90, limit=100'
  assert.throws(
    () =>
      gpu.device.createBuffer({ label: 'shared cache', size: 20, usage: GPUBufferUsage.STORAGE }),
    {
      message: refused,
    },
  )
  assert.equal(session.refusal?.message, refused)
  assert.equal(base.refusal?.message, refused, 'the device that made the request reads it too')
  assert.equal(base.bytes, 0)
  session.releaseAdmission()
  handle.release()
})

test('a tentative allocation past the limit throws without refusing the session', () => {
  const gpu = fakeDevice()
  const ledger = installGpuDeviceLedger(gpu.device, { limit: () => 100 })
  gpu.device.createBuffer({ label: 'held', size: 90, usage: GPUBufferUsage.STORAGE })
  assert.equal(ledger.room, 10)
  assert.throws(
    () =>
      ledger.tentative(() =>
        gpu.device.createBuffer({ label: 'big', size: 20, usage: GPUBufferUsage.STORAGE }),
      ),
    /GPU_BUDGET_EXCEEDED/,
  )
  assert.equal(ledger.refusal, undefined, 'a caller with a fallback is not a refused session')
  assert.equal(
    ledger.tentative(() => 7),
    7,
  )
  assert.throws(() =>
    gpu.device.createBuffer({ label: 'big', size: 20, usage: GPUBufferUsage.STORAGE }),
  )
  assert.match(ledger.refusal!.message, /label=big/, 'outside it, a refusal stands as ever')
})

test("a shared allocation made tentatively past another session's limit refuses no session", () => {
  const gpu = fakeDevice()
  const base = installGpuDeviceLedger(gpu.device, { counts: namesNoSession })
  const [a, b] = ['@t3d:9', '@t3d:10'].map((tag) => sessionHandle(gpu.device, tag))
  const first = installGpuDeviceLedger(a.device, { base, limit: () => 100 })
  const second = installGpuDeviceLedger(b.device, { base, limit: () => 100 })
  b.device.createBuffer({ label: 'held', size: 90, usage: GPUBufferUsage.STORAGE })
  // The first session tries a shared allocation it has a smaller one to fall back on: past the
  // second's limit, it throws as ever, and neither session is refused for it.
  assert.throws(
    () =>
      first.tentative(() =>
        gpu.device.createBuffer({ label: 'shared', size: 20, usage: GPUBufferUsage.STORAGE }),
      ),
    /GPU_BUDGET_EXCEEDED: requested=20, label=shared/,
  )
  assert.equal(second.refusal, undefined, 'the other session is not refused for it')
  assert.equal(first.refusal, undefined)
  // Outside it, the same allocation refuses the session whose limit it crosses, as ever.
  assert.throws(() =>
    gpu.device.createBuffer({ label: 'shared', size: 20, usage: GPUBufferUsage.STORAGE }),
  )
  assert.match(second.refusal!.message, /label=shared/)
  for (const session of [first, second]) session.releaseAdmission()
  a.release()
  b.release()
})
