// A picture read as a bitmap or as data keeps the numbers its file stores: decoded by the engine's
// one decoder, neither premultiplied nor colour-converted, as a baked level or a prepared scene
// image is, and never drawn through a canvas, which would premultiply it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { loader } from './loaderFamily.ts'

const RAW = { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }

test('a bitmap and a data picture are the decoder’s own, with no canvas between', async (t) => {
  const asked: unknown[] = [],
    decoded: object[] = []
  const decode = async (_blob: Blob, options?: ImageBitmapOptions) => {
    asked.push(options)
    const bitmap = { width: 1, height: 1 }
    decoded.push(bitmap)
    return bitmap
  }
  const answer = async () => new Response(new Uint8Array([0]), { status: 200 })
  const scope = globalThis as Record<string, unknown>
  const stubs = { createImageBitmap: decode, OffscreenCanvas: undefined, fetch: answer }
  const kept = Object.fromEntries(Object.keys(stubs).map((name) => [name, scope[name]]))
  Object.assign(scope, stubs)
  t.after(() => Object.assign(scope, kept))
  assert.equal(await loader.imageBitmap('https://example.test/albedo.png'), decoded[0])
  const map = await loader.data('https://example.test/normal.png')
  assert.deepEqual(asked, [RAW, RAW])
  assert.equal(map.image, decoded[1], 'the bitmap itself, no pixels read back')
  assert.deepEqual([map.colorSpace, map.flipY, map.premultiplyAlpha], ['linear', false, false])
})
