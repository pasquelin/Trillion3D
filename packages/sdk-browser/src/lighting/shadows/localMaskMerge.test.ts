import assert from 'node:assert/strict'
import test from 'node:test'
import { localMaskMerge } from './localMaskMerge.ts'

Object.assign(globalThis, { GPUTextureUsage: { STORAGE_BINDING: 8, TEXTURE_BINDING: 4 } })

type Gpu = Parameters<ReturnType<typeof localMaskMerge>['layersFor']>[0]

test('the layers are kept a view: one view asking or letting go leaves the other’s textures', () => {
  let made = 0
  const destroyed: string[] = []
  const device = {
    createTexture: ({ label }: { label: string }) => {
      made++
      return {
        label,
        createView: () => ({}),
        destroy: () => destroyed.push(label),
      }
    },
    queue: {},
  } as unknown as GPUDevice
  const merger = localMaskMerge({
    label: 'merge',
    passLabel: 'merge',
    entry: 'main',
    module: () => ({}) as GPUShaderModule,
  })
  const a = {} as Gpu
  const b = {} as Gpu
  const first = merger.layersFor(a, device, [4, 4], 2)
  const other = merger.layersFor(b, device, [4, 4], 2)
  assert.notEqual(first, other)
  assert.equal(merger.layersFor(a, device, [4, 4], 2), first)
  assert.equal(made, 2)
  merger.release(b)
  assert.equal(merger.layersFor(a, device, [4, 4], 1), first)
  assert.equal(merger.layersFor(b, device, [4, 4], 2) === other, false)
})

test('the layers shrink to the most lights asked once a keeping window passes', () => {
  const device = {
    createTexture: ({ label }: { label: string }) => ({
      label,
      createView: () => ({}),
      destroy: () => {},
    }),
    queue: {},
  } as unknown as GPUDevice
  const merger = localMaskMerge({
    label: 'merge',
    passLabel: 'merge',
    entry: 'main',
    module: () => ({}) as GPUShaderModule,
  })
  const view = {} as Gpu
  const big = merger.layersFor(view, device, [4, 4], 8, false, 0)
  assert.equal(merger.layersFor(view, device, [4, 4], 2, false, 10), big)
  assert.equal(merger.layersFor(view, device, [4, 4], 2, false, 119), big)
  // The window that began at 0 asked 8 at most: it ends holding that, and the next asks 2.
  assert.equal(merger.layersFor(view, device, [4, 4], 2, false, 120), big)
  const shrunk = merger.layersFor(view, device, [4, 4], 2, false, 240)
  assert.notEqual(shrunk, big)
  assert.equal(shrunk.capacity, 2)
})

test('layers made on another device are destroyed at once and made again on the new one', () => {
  const destroyed: string[] = []
  const deviceOf = (name: string) =>
    ({
      createTexture: ({ label }: { label: string }) => ({
        label: `${name} ${label}`,
        createView: () => ({}),
        destroy: () => destroyed.push(`${name} ${label}`),
      }),
      queue: {},
    }) as unknown as GPUDevice
  const merger = localMaskMerge({
    label: 'merge',
    passLabel: 'merge',
    entry: 'main',
    module: () => ({}) as GPUShaderModule,
  })
  const view = {} as Gpu
  const first = merger.layersFor(view, deviceOf('old'), [4, 4], 2)
  const moved = merger.layersFor(view, deviceOf('new'), [4, 4], 2)
  assert.notEqual(moved, first)
  assert.deepEqual(destroyed, ['old merge'])
})

test('the blockers’ distances stay while a window asks them and go when one ends without', () => {
  const device = {
    createTexture: ({ label }: { label: string }) => ({
      label,
      createView: () => ({}),
      destroy: () => {},
    }),
    queue: {},
  } as unknown as GPUDevice
  const merger = localMaskMerge({
    label: 'merge',
    passLabel: 'merge',
    entry: 'main',
    module: () => ({}) as GPUShaderModule,
  })
  const view = {} as Gpu
  const withHits = merger.layersFor(view, device, [4, 4], 2, true, 0)
  assert.ok(withHits.hits)
  // Asked once in the window: kept without being asked again.
  assert.equal(merger.layersFor(view, device, [4, 4], 2, false, 50), withHits)
  // The window ended having asked them: the next one starts without.
  assert.equal(merger.layersFor(view, device, [4, 4], 2, false, 120), withHits)
  const dropped = merger.layersFor(view, device, [4, 4], 2, false, 240)
  assert.notEqual(dropped, withHits)
  assert.equal(dropped.hits, undefined)
})
