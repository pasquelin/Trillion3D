import assert from 'node:assert/strict'
import { test } from 'node:test'
import { probeWorldDevice } from '../capability/worldReady.ts'
import { holdWorldDevice, worldRecovered } from './worldDevice.ts'
import { createWorldNotices, listenWorldNotices } from '../diagnostic/worldNotices.ts'
import { createPageCache } from '../../streaming/pageCache.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { WEBGPU_REQUIRED_WGSL_FEATURES } from '../../engine/common.ts'

test('an adapter that refuses its device refuses the world by name', async () => {
  const adapter = {
    features: new Set<string>(),
    limits: {},
    requestDevice: () => Promise.reject(new Error('device refused')),
  }
  const saved = globalThis.navigator
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      gpu: {
        wgslLanguageFeatures: new Set<string>(WEBGPU_REQUIRED_WGSL_FEATURES),
        requestAdapter: async () => adapter,
      },
    },
  })
  try {
    await assert.rejects(
      probeWorldDevice(),
      (error: unknown) =>
        (error as { code?: string }).code === 'WEBGPU_UNAVAILABLE' &&
        /refused a device \(Error: device refused\)/.test((error as Error).message),
    )
  } finally {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: saved })
  }
})

test('a lost device is asked for again, and the session reopened on the new one', async () => {
  const devices = [fakeDevice(), fakeDevice()]
  let asked = 0,
    reopened = 0,
    lostAt = NaN
  const probe = async () => devices[asked++].device as unknown as GPUDevice
  const held = holdWorldDevice((at) => {
    reopened++
    lostAt = at
  }, probe)
  await held.ready
  assert.equal(held.gpuDevice, devices[0].device)
  const warn = console.warn
  console.warn = () => {}
  const before = performance.now()
  devices[0].lose({ reason: 'unknown', message: 'driver reset' })
  for (let turn = 0; turn < 10 && !reopened; turn++) await new Promise(setImmediate)
  console.warn = warn
  assert.equal(reopened, 1)
  assert.ok(lostAt >= before && lostAt <= performance.now(), 'the reopen is told when it was lost')
  assert.equal(held.gpuDevice, devices[1].device)
  // The world's own disposal destroys its device, and a loss by `destroy` asks for nothing.
  held.dispose()
  devices[1].lose({ reason: 'destroyed', message: '' })
  await new Promise(setImmediate)
  assert.ok(devices[1].destroyed.includes(devices[1].device))
  assert.equal(asked, 2)
})

test('a session opened while a device is asked again waits on it, and a refused grant fails', async () => {
  const first = fakeDevice()
  let refuse!: (error: Error) => void
  let asked = 0,
    reopened = 0
  const probe = () =>
    asked++ === 0
      ? Promise.resolve(first.device as unknown as GPUDevice)
      : new Promise<GPUDevice>((_, reject) => (refuse = reject))
  const held = holdWorldDevice(() => reopened++, probe)
  await held.ready
  const warn = console.warn
  console.warn = () => {}
  first.lose({ reason: 'unknown', message: 'driver reset' })
  for (let turn = 0; turn < 10 && asked < 2; turn++) await new Promise(setImmediate)
  console.warn = warn
  // In the window, no device is held: an opening waits on the grant.
  assert.equal(held.gpuDevice, undefined)
  assert.notEqual(held.pending, held.ready)
  let settled = false
  const opening = held.pending.then(
    () => (settled = true),
    (error: Error) => error,
  )
  await new Promise(setImmediate)
  assert.equal(settled, false)
  // The machine now grants no device: the grant fails by name.
  refuse(new Error('WEBGPU_UNAVAILABLE: none granted again'))
  assert.match(String(await opening), /none granted again/)
  for (let turn = 0; turn < 10 && !reopened; turn++) await new Promise(setImmediate)
  assert.equal(reopened, 1, 'the session reopens, and reports the refusal')
  held.dispose()
})

test('a recovered world reopens its session and says the time to its first frame, once', async () => {
  const said: Array<{ phase: string; context: Record<string, unknown> }> = []
  const stop = listenWorldNotices((notice) => said.push(notice as (typeof said)[number]))
  const notices = createWorldNotices()
  const hooks = new Set<() => void>()
  const frames = {
    add: (hook: () => void) => (hooks.add(hook), () => void hooks.delete(hook)),
    draw: () => [...hooks].forEach((hook) => hook()),
  }
  const cache = createPageCache()
  cache.touch('kept.bin', new Uint8Array(4))
  let renewed = 0
  worldRecovered({ renew: () => renewed++ }, frames, notices, cache, performance.now() - 5)
  assert.equal(renewed, 1, 'the session reopens on the device granted again')
  frames.draw()
  frames.draw()
  await new Promise(setImmediate)
  notices.close()
  stop()
  assert.deepEqual(
    said.map((notice) => notice.phase),
    ['gpu-device-recovered'],
  )
  assert.ok(Number(said[0].context.recoveryMs) >= 5)
  assert.equal(said[0].context.keptPages, 1)
})
