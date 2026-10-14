// A picture read as data keeps the numbers its file stores: decoded by the engine's one decoder,
// neither premultiplied nor colour-converted, as a baked level or a prepared scene image is.
import test from 'node:test'
import assert from 'node:assert/strict'
import { loader } from './loaderFamily.ts'

test('a data picture is decoded with the options of every image the engine samples', async (t) => {
  const asked: unknown[] = []
  const decode = async (_blob: Blob, options?: ImageBitmapOptions) => {
    asked.push(options)
    return { width: 1, height: 1 }
  }
  class Page {
    getContext = () => ({
      drawImage() {},
      getImageData: () => ({ data: new Uint8ClampedArray([1, 2, 3, 4]) }),
    })
  }
  const answer = async () => new Response(new Uint8Array([0]), { status: 200 })
  const scope = globalThis as Record<string, unknown>
  const stubs = { createImageBitmap: decode, OffscreenCanvas: Page, fetch: answer }
  const kept = Object.fromEntries(Object.keys(stubs).map((name) => [name, scope[name]]))
  Object.assign(scope, stubs)
  t.after(() => Object.assign(scope, kept))
  await loader.data('https://example.test/normal.png')
  assert.deepEqual(asked, [{ premultiplyAlpha: 'none', colorSpaceConversion: 'none' }])
})
