// The first-person self shadow's textures are let go by their keeping windows, not by an image that gives no self shadow.
import test from 'node:test'
import assert from 'node:assert/strict'
import type { ShadowValues } from '../../../../../../sdk-core/src/contracts/shadowOptions.ts'
import { destroyRetired } from '../../../../gpu/core/frameRetire.ts'
import { IDLE_KEEP_IMAGES } from '../../../../gpu/core/idleKeep.ts'
import { gridFor } from '../../firstPerson/selfShadowKit.ts'
import { keepFirstPersonSelfShadow } from '../../firstPerson/selfShadow.ts'
import { selfShadowLights } from './vsmSelfShadow.ts'

;(globalThis as { GPUTextureUsage?: unknown }).GPUTextureUsage ??= { STORAGE_BINDING: 8 }

test('images without a self shadow give none, keep the kit through the window and let it go once a window asked nothing', () => {
  const gpu: { viewKey?: object } = {}
  const rt = { gpu } as unknown as Parameters<typeof selfShadowLights>[0]
  let destroyed = 0
  const device = {
    createTexture: () => ({ createView: () => ({}), destroy: () => destroyed++ }),
  } as unknown as GPUDevice
  gridFor(gpu, device, [4, 4], 1, 0)
  const image = (frame: number) => {
    const given = selfShadowLights(rt, { shadowFirstPersonSelfShadow: false } as ShadowValues, [])
    assert.deepEqual(given, { suns: false, locals: false })
    keepFirstPersonSelfShadow(gpu, frame)
    destroyRetired(device)
  }
  // No immediate release on a toggle: the first window asked a layer and holds it to its end.
  for (let frame = 1; frame <= IDLE_KEEP_IMAGES; frame++) image(frame)
  assert.equal(destroyed, 0)
  // The next window asked nothing: the kit goes when it ends.
  for (let frame = IDLE_KEEP_IMAGES + 1; frame <= 2 * IDLE_KEEP_IMAGES - 1; frame++) image(frame)
  assert.equal(destroyed, 0)
  image(2 * IDLE_KEEP_IMAGES)
  assert.equal(destroyed, 4)
})
