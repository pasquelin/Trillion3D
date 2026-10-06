import test from 'node:test'
import assert from 'node:assert/strict'
import { WebglPhysicalMaps } from './physicalMaps.ts'
import { createTestContext } from '../core/testContext.fixture.ts'
import { Matrix3UniformCache } from './uniforms.ts'
import { visMaterial } from '../../visibility/shader/material.ts'
import * as G from '../../host/graph/graph.fixture.ts'
import { importHostTexture } from '../../host/textureImport.ts'
import type { Texture } from '../../../../sdk-core/src/index.ts'
import { physicalMapLayout } from './physicalMapLayout.ts'

test('different native map dimensions reserve actual padded mip storage and refuse device limits', () => {
  const layout = physicalMapLayout(
    [
      [7, 5],
      [2, 9],
      [1, 1],
    ],
    16,
  )
  assert.deepEqual(layout, {
    width: 7,
    height: 9,
    levels: 4,
    layers: 3,
    bytes: (7 * 9 + 3 * 4 + 1 * 2 + 1) * 12,
  })
  assert.throws(() => physicalMapLayout([[17, 3]], 16), /PHYSICAL_MAP_DEVICE_LIMIT/)
})

test('array copies every native mip once, preserves UV-only edits and releases replacements', () => {
  const context = createTestContext({
    answers: {
      getParameter: (name: string) =>
        name === 'MAX_TEXTURE_SIZE' ? 4096 : name === 'MAX_ARRAY_TEXTURE_LAYERS' ? 256 : null,
    },
  })
  const gl = context.gl
  const maps = new WebglPhysicalMaps(gl)
  const first = importHostTexture(G.dataTexture(new Uint8Array(7 * 5 * 4), 7, 5))
  const second = importHostTexture(G.dataTexture(new Uint8Array(2 * 9 * 4), 2, 9))
  Object.assign(first, { minFilter: 'linear-mip-linear' })
  Object.assign(second, { minFilter: 'linear-mip-linear' })
  const material = { ...visMaterial([]), anisotropyMap: first, clearcoatNormalMap: second }
  const sources = new Map<
    Texture,
    { texture: WebGLTexture; format: number; width: number; height: number; version: number }
  >([
    [first, { texture: {} as WebGLTexture, format: gl.RGBA8, width: 7, height: 5, version: 0 }],
    [second, { texture: {} as WebGLTexture, format: gl.RGBA8, width: 2, height: 9, version: 0 }],
  ])
  const at = (name: string) => ({ name }) as unknown as WebGLUniformLocation
  const matrices = new Matrix3UniformCache(gl, at)
  const bind = () => maps.bind(material, material, (texture) => sources.get(texture)!, at, matrices)
  bind()
  const copies = context.of('copyTexSubImage3D')
  assert.deepEqual(
    copies.map((args) => [args[1], args[4], args[7], args[8]]),
    [
      [0, 0, 7, 5],
      [1, 0, 3, 2],
      [2, 0, 1, 1],
      [0, 1, 2, 9],
      [1, 1, 1, 4],
      [2, 1, 1, 2],
      [3, 1, 1, 1],
    ],
  )
  assert.equal(maps.bytes, 624)
  Object.assign(first.transform, { 6: 0.25 })
  bind()
  assert.equal(context.of('copyTexSubImage3D').length, 7, 'placement alone never recopies an image')
  Object.assign(first, { version: first.version + 1 })
  sources.get(first)!.width = 3
  bind()
  assert.equal(context.of('deleteTexture').length, 1, 'old array released after replacement')
  assert.equal(maps.bytes, (3 * 9 + 1 * 4 + 1 * 2 + 1) * 8)
  maps.dispose()
  assert.equal(maps.bytes, 0)
  assert.equal(context.of('deleteTexture').filter(([texture]) => texture !== null).length, 2)
})

test('failed framebuffer copy releases the new array and keeps the previous draw target', () => {
  const previous = {} as WebGLFramebuffer
  const context = createTestContext({
    answers: {
      getParameter: (name: string) => (name === 'READ_FRAMEBUFFER_BINDING' ? previous : 4096),
      checkFramebufferStatus: () => 'FRAMEBUFFER_INCOMPLETE_ATTACHMENT',
    },
  })
  const map = importHostTexture(G.dataTexture(new Uint8Array(4), 1, 1))
  const owner = new WebglPhysicalMaps(context.gl)
  const mat = { ...visMaterial([]), anisotropyMap: map }
  assert.throws(
    () =>
      owner.bind(
        mat,
        mat,
        () => ({
          texture: {} as WebGLTexture,
          width: 1,
          height: 1,
          format: context.gl.RGBA8,
          version: 0,
        }),
        () => null,
        new Matrix3UniformCache(context.gl, () => null),
      ),
    /PHYSICAL_MAP_COPY_FRAMEBUFFER/,
  )
  assert.equal(owner.bytes, 0)
  assert.equal(context.of('deleteTexture').length, 1)
  assert.equal(context.of('bindFramebuffer').at(-1)?.[1], previous)
  owner.dispose()
})

test('materials share image tuples, retain other users and release removed sources and declarations', () => {
  const context = createTestContext({ answers: { getParameter: () => 4096 } })
  const maps = new WebglPhysicalMaps(context.gl)
  const source = importHostTexture(G.dataTexture(new Uint8Array(16), 2, 2))
  const material = { ...visMaterial([]), anisotropyMap: source }
  const chain = {
    texture: {} as WebGLTexture,
    width: 2,
    height: 2,
    version: 0,
    format: context.gl.RGBA8,
  }
  const matrices = new Matrix3UniformCache(context.gl, () => null)
  const first = {},
    second = {}
  const bind = (owner: object) =>
    maps.bind(
      owner,
      material,
      () => chain,
      () => null,
      matrices,
    )
  bind(first)
  const bytes = maps.bytes
  const copies = context.of('copyTexSubImage3D').length
  bind(second)
  assert.equal(maps.bytes, bytes, 'identical tuples reserve one array')
  assert.equal(context.of('copyTexSubImage3D').length, copies, 'second material copies no pixels')
  maps.cache.release(first)
  assert.equal(maps.bytes, bytes, 'remaining owner keeps shared pixels')
  assert.equal(context.of('deleteTexture').length, 0)
  maps.cache.releaseTexture(source)
  assert.equal(maps.bytes, 0, 'source retirement invalidates every tuple that copied it')
  bind(second)
  maps.cache.census(new Set())
  assert.equal(maps.bytes, 0, 'removed declarations release their last reference')
  assert.equal(context.of('deleteTexture').length, 2)
  bind(first)
  bind(second)
  Object.assign(source, { version: source.version + 1 })
  bind(first)
  assert.equal(maps.bytes, bytes * 2, 'another live owner retains its previous image version')
  bind(second)
  assert.equal(maps.bytes, bytes, 'last old-version owner releases the replaced tuple')
  maps.dispose()
  assert.equal(maps.bytes, 0)
})
