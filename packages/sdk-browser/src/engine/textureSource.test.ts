import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveTextureSource } from './textureSource.ts'

/** Runs `body` on a runtime that reads bitmaps, or on one that has no `createImageBitmap` at
 *  all — node has none of its own, so both states are installed here and then withdrawn. */
function onRuntime(bitmaps: boolean, body: () => void) {
  const held = Reflect.get(globalThis, 'createImageBitmap') as unknown
  if (bitmaps) Reflect.set(globalThis, 'createImageBitmap', () => Promise.resolve({}))
  else Reflect.deleteProperty(globalThis, 'createImageBitmap')
  try {
    body()
  } finally {
    if (held === undefined) Reflect.deleteProperty(globalThis, 'createImageBitmap')
    else Reflect.set(globalThis, 'createImageBitmap', held)
  }
}

test('the engine reads the baked levels by default, and a host asking for the images is obeyed', () => {
  onRuntime(true, () => {
    assert.equal(resolveTextureSource(undefined), 'cache')
    assert.equal(resolveTextureSource('cache'), 'cache')
    assert.equal(resolveTextureSource('host'), 'host')
  })
})

test('without createImageBitmap no level can be read, so the images are', () => {
  onRuntime(false, () => {
    assert.equal(resolveTextureSource('cache'), 'host')
    assert.equal(resolveTextureSource(undefined), 'host')
  })
})
