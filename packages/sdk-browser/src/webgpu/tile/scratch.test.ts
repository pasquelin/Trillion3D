// #362: the working texture of a page texture is uploaded the way a host texture reads it: a
// canvas, a video frame or a turned and tiled picture, `flipY` by default, lands with its last row
// at v = 0; a picture that says `flipY: false` (a decoded glTF image, raw texels) lands as it is.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createTileScratch } from './scratch.ts'
import { texture } from '../../world/texture/index.ts'
import { hostTexture } from '../../world/core/worldTextures.ts'
import { importHostTexture } from '../../host/textureImport.ts'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'
import { mockGpu } from '../../../../../tests/kit/gpu/mockGpu.ts'
import type { Texture } from '../../../../sdk-core/src/world/texture/texture.ts'
import { GraphTexture } from '../../host/graph/graph.fixture.ts'
import { CoverageReaders } from '../../texture/coverage.ts'
import type { PageSurface } from '../../page/surface.ts'

type HostTexture = InstanceType<typeof GraphTexture>

type Copy = {
  source: { source: unknown; flipY?: boolean }
  destination: { premultipliedAlpha?: boolean }
}

/** Uploads a page texture through the engine's own chain — its surface texture, its record — into
 *  a working texture; returns the external copies and the texel rows written. */
function upload(page: Texture | HostTexture, [width, height]: [number, number]) {
  installGpuGlobals()
  const { device } = mockGpu()
  const copies: Copy[] = [],
    rows: Uint8Array[] = []
  Object.assign(device.queue, {
    copyExternalImageToTexture: (source: Copy['source'], destination: Copy['destination']) =>
      copies.push({ source, destination }),
    writeTexture: (_to: unknown, data: Uint8Array) => rows.push(new Uint8Array(data)),
  })
  const map = importHostTexture(
    page instanceof GraphTexture ? page : hostTexture(page, true, new Map()),
  )
  createTileScratch(device, {
    map,
    width,
    height,
    format: 'rgba8unorm',
    errorCode: 'NONE',
  })
  return { copies, rows }
}

test('a canvas is copied with its rows flipped, its last row at v = 0', () => {
  const canvas = { width: 1, height: 1 } as HTMLCanvasElement
  const { copies } = upload(texture.canvas(canvas), [1, 1])
  assert.equal(copies.length, 1)
  assert.equal(copies[0].source.source, canvas)
  assert.equal(copies[0].source.flipY, true)
})

test('a video frame is copied with its rows flipped', () => {
  const video = {
    videoWidth: 1,
    videoHeight: 1,
    paused: true,
    ended: false,
    addEventListener() {},
  } as unknown as HTMLVideoElement
  const { copies } = upload(texture.video(video), [1, 1])
  assert.equal(copies[0].source.flipY, true)
})

test('a turned, tiled picture is flipped at upload, its placement left to the sampler', () => {
  const canvas = { width: 1, height: 1 } as HTMLCanvasElement
  const tile = texture.canvas(canvas)
  tile.wrap = 'repeat'
  tile.repeat.set(4, 4)
  tile.rotation = Math.PI / 6
  const { copies } = upload(tile, [1, 1])
  assert.equal(copies[0].source.flipY, true)
})

test('a picture that says flipY false is copied as it is', () => {
  const canvas = { width: 1, height: 1 } as HTMLCanvasElement
  const kept = texture.canvas(canvas)
  kept.flipY = false
  assert.equal(upload(kept, [1, 1]).copies[0].source.flipY, false)
})

// #43: texels the RGBA8 working texture cannot hold as stored — three channels, one, floats, fewer
// bytes than the size holds — are refused in `texelsReason`'s words, never written as RGBA8 to
// draw wrong or fail the device's validation.
test('texels the RGBA8 working texture cannot hold as stored are refused by name', () => {
  const refused: [string, ...Parameters<typeof texture.data>][] = [
    ['texel format 1022 is unsupported: RGBA only', new Uint8Array(12), 2, 2, 'rgb'],
    ['texel format 1028 is unsupported: RGBA only', new Uint8Array(4), 2, 2, 'r'],
    ['texel storage is unsupported: 8-bit texels only', new Float32Array(16), 2, 2],
    ['texel storage holds 8 bytes, not 2×2 RGBA', new Uint8Array(8), 2, 2],
  ]
  for (const [message, ...texels] of refused)
    assert.throws(() => upload(texture.data(...texels), [2, 2]), { message })
})

// A host texture that says `premultiplyAlpha` lands with its colour times its alpha.
test('a premultiplyAlpha canvas is copied premultiplied; one that does not say so is not', () => {
  const canvas = { width: 1, height: 1 } as HTMLCanvasElement
  const host = new GraphTexture(canvas)
  host.premultiplyAlpha = true
  assert.equal(upload(host, [1, 1]).copies[0].destination.premultipliedAlpha, true)
  assert.equal(
    upload(texture.canvas(canvas), [1, 1]).copies[0].destination.premultipliedAlpha,
    false,
  )
})

// #42: the working texture's mips weigh their colours by alpha only for a texture every reader
// takes for coverage, and not when the upload already premultiplied them — weighing twice would
// darken the borders again. A colour texture an opaque or emissive reader draws stays plain.
test('a coverage working texture reduces weighted by alpha unless uploaded premultiplied', () => {
  installGpuGlobals()
  // One device per case: the one reduction pipeline it builds says the rule the texture took.
  const rule = (coverage: boolean, premultiplyAlpha: boolean) => {
    const { device, computePipelines } = mockGpu()
    const host = new GraphTexture({ data: new Uint8Array(8), width: 1, height: 2 })
    host.premultiplyAlpha = premultiplyAlpha
    const map = importHostTexture(host)
    const readers = new CoverageReaders()
    readers.read({ map, alphaTest: coverage ? 0.5 : 0, transparent: false } as PageSurface)
    const size = { width: 1, height: 2, format: 'rgba8unorm' } as const
    createTileScratch(device, { map, ...size, errorCode: 'NONE', coverage: readers }).reduce()
    return computePipelines
      .filter(({ compute }) => compute.entryPoint === 'reduceLevel')
      .map(({ compute }) => compute.constants?.weighted)
  }
  assert.deepEqual(rule(true, false), [1], 'straight alpha read as coverage: weighted')
  assert.deepEqual(rule(true, true), [0], 'uploaded premultiplied: plain')
  assert.deepEqual(rule(false, false), [0], 'not read as coverage: plain')
})

// A colour working texture's levels are written by a compute pass, and an sRGB format takes no
// storage: it is `rgba8unorm` with storage, read and copied through its sRGB view, whose usage
// names no storage binding (the device lost at prepare in Chrome otherwise).
test('a colour working texture is stored rgba8unorm with storage, viewed in the pool format', () => {
  installGpuGlobals()
  const { device, textures } = mockGpu()
  const created: GPUTextureDescriptor[] = [],
    create = device.createTexture.bind(device)
  device.createTexture = (descriptor) => (created.push(descriptor), create(descriptor))
  const map = importHostTexture(new GraphTexture({ data: new Uint8Array(16), width: 2, height: 2 }))
  const scratch = createTileScratch(device, {
    map,
    width: 2,
    height: 2,
    format: 'rgba8unorm-srgb',
    errorCode: 'NONE',
  })
  assert.equal(textures.at(-1)!.format, 'rgba8unorm')
  assert.deepEqual([...created[0].viewFormats!], ['rgba8unorm-srgb'])
  assert.ok(created[0].usage & GPUTextureUsage.STORAGE_BINDING)
  assert.equal(scratch.chain().format, 'rgba8unorm-srgb', 'its levels read decoded')
  // Its sRGB reads name a usage without storage binding: one left to the texture's is refused.
  scratch.reduce()
  assert.throws(() => scratch.texture.createView({ format: 'rgba8unorm-srgb' }), /StorageBinding/)
  scratch.destroy()
})
