// The engine's one decoder reads a raster file as it stores its pixels, and a vector file — which
// `createImageBitmap` refuses — through an image element's drawing of it, with the same options.
import test from 'node:test'
import assert from 'node:assert/strict'
import { decodeRaw } from './decode.ts'

const RAW = { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }

test('a raster file is decoded from its bytes, an SVG from an image element drawing it', async (t) => {
  const sources: unknown[] = [],
    revoked: string[] = []
  class Drawing {
    src = ''
    decode = async () => undefined
  }
  const stubs = {
    createImageBitmap: async (source: unknown, options: unknown) => {
      sources.push(source)
      assert.deepEqual(options, RAW)
      return { width: 1, height: 1 }
    },
    Image: Drawing,
  }
  const scope = globalThis as Record<string, unknown>
  const kept = Object.fromEntries(Object.keys(stubs).map((name) => [name, scope[name]]))
  const revoke = URL.revokeObjectURL
  Object.assign(scope, stubs)
  URL.revokeObjectURL = (url) => void revoked.push(url)
  t.after(() => {
    Object.assign(scope, kept)
    URL.revokeObjectURL = revoke
  })
  const png = new Blob([new Uint8Array([0])], { type: 'image/png' })
  await decodeRaw(png)
  await decodeRaw(
    new Blob(['<svg xmlns="http://www.w3.org/2000/svg"/>'], { type: 'image/svg+xml' }),
  )
  assert.equal(sources[0], png)
  assert.ok(sources[1] instanceof Drawing)
  assert.deepEqual(revoked, [(sources[1] as Drawing).src], 'the drawing’s address is given back')
})
