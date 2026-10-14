import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../host/graph/graph.fixture.ts'
import { compareImages } from '../../../sdk-core/src/index.ts'
import { shadeVisibility } from '../../../../bench/oracles/browser/cpu-image/shade.ts'
import { camera, nearestQuadTexture, quadPages } from './buffer.fixture.ts'
import { engineCamera } from '../camera/camera.fixture.ts'
import { surfaceOf } from '../page/surface.ts'
import { identityRoots } from '../page/selection/placements.fixture.ts'
import { DIRECT_LIGHTING_SHADER } from '../gpu/core/shaderTexts.fixture.ts'
import { VIS_INVALID } from '../../../../bench/oracles/browser/cpu-image/ids.ts'
import { rasterVisibilityIds } from '../../../../bench/oracles/browser/cpu-image/raster.ts'

test('Repeat wrap samples the same texel at UV 0.25 and 1.25', () => {
  const map = nearestQuadTexture()
  map.wrapS = 'repeat'
  map.wrapT = 'repeat'
  const a = G.basicSurface({ color: 0xffffff, map })
  const b = G.basicSurface({ color: 0xffffff, map })
  const left = quadPages(a, [0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25])
  const right = quadPages(b, [1.25, 0.25, 1.25, 0.25, 1.25, 0.25, 1.25, 0.25])
  const cam = camera(),
    size: [number, number] = [16, 16]
  const ids = rasterVisibilityIds(left.pages, identityRoots(), engineCamera(cam), size)
  const image = compareImages(
    shadeVisibility(ids, left.pages, identityRoots(), engineCamera(cam), size),
    shadeVisibility(
      rasterVisibilityIds(right.pages, identityRoots(), engineCamera(cam), size),
      right.pages,
      identityRoots(),
      engineCamera(cam),
      size,
    ),
  )
  assert.equal(image.maxChannelError, 0)
  left.geometry.dispose()
  right.geometry.dispose()
  a.dispose()
  b.dispose()
  map.dispose()
})

test('FrontSide visbuffer culls a back-facing triangle', () => {
  const material = G.basicSurface({ color: 0xff0000, side: G.FRONT_SIDE })
  const { pages, geometry } = quadPages(material)
  const cam = G.perspectiveCamera(55, 1, 0.1, 100)
  cam.position.z = -5
  cam.lookAt(0, 0, 0)
  cam.updateMatrixWorld()
  const ids = rasterVisibilityIds(pages, identityRoots(), engineCamera(cam), [16, 16])
  assert.ok([...ids].every((id) => id === VIS_INVALID))
  geometry.dispose()
  material.dispose()
})

test('a metalness map B=0 keeps a dielectric; B=1 is a metal', () => {
  const dielectric = G.dataTexture(new Uint8Array([0, 255, 0, 255]), 1, 1, 'rgba')
  const metal = G.dataTexture(new Uint8Array([0, 255, 255, 255]), 1, 1, 'rgba')
  const a = G.standardSurface({
    color: 0xffffff,
    metalness: 1,
    roughness: 1,
    metalnessMap: dielectric,
  })
  const b = G.standardSurface({
    color: 0xffffff,
    metalness: 1,
    roughness: 1,
    metalnessMap: metal,
  })
  const { pages, geometry } = quadPages(a, [0, 0, 1, 0, 1, 1, 0, 1])
  const metalPages = pages.map((page) => ({ ...page, material: surfaceOf(b) }))
  const cam = camera(),
    size: [number, number] = [16, 16]
  const ids = rasterVisibilityIds(pages, identityRoots(), engineCamera(cam), size)
  const dark = shadeVisibility(ids, pages, identityRoots(), engineCamera(cam), size),
    bright = shadeVisibility(ids, metalPages, identityRoots(), engineCamera(cam), size)
  assert.ok(compareImages(dark, bright).maxChannelError > 0)
  assert.equal(surfaceOf(a).metalness, 1)
  assert.ok(surfaceOf(a).metalnessMap)
  geometry.dispose()
  a.dispose()
  b.dispose()
  dielectric.dispose()
  metal.dispose()
})

test('a roughness map G channel changes the GGX highlight', () => {
  const smooth = G.dataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, 'rgba')
  const rough = G.dataTexture(new Uint8Array([0, 255, 0, 255]), 1, 1, 'rgba')
  const a = G.standardSurface({
    color: 0xffffff,
    metalness: 1,
    roughness: 1,
    roughnessMap: smooth,
  })
  const b = G.standardSurface({
    color: 0xffffff,
    metalness: 1,
    roughness: 1,
    roughnessMap: rough,
  })
  const { pages, geometry } = quadPages(a, [0, 0, 1, 0, 1, 1, 0, 1])
  const roughPages = pages.map((page) => ({ ...page, material: surfaceOf(b) }))
  const cam = camera(),
    size: [number, number] = [16, 16]
  const ids = rasterVisibilityIds(pages, identityRoots(), engineCamera(cam), size)
  assert.ok(
    compareImages(
      shadeVisibility(ids, pages, identityRoots(), engineCamera(cam), size),
      shadeVisibility(ids, roughPages, identityRoots(), engineCamera(cam), size),
    ).maxChannelError > 0,
  )
  geometry.dispose()
  a.dispose()
  b.dispose()
  smooth.dispose()
  rough.dispose()
})

test('transmissive MeshPhysicalMaterial is not packed for the visbuffer', () => {
  const material = G.physicalSurface({
    color: 0x228866,
    transmission: 1,
    thickness: 0.02,
    roughness: 0,
    metalness: 0,
  })
  assert.equal(surfaceOf(material).transmission, 1)
  assert.equal(G.standardSurface().transmission, 0)
  material.dispose()
})

test('MeshStandardMaterial visbuffer lighting implements Cook-Torrance GGX microfacet BRDF', () => {
  const basic = G.basicSurface({ color: 0x331111 })
  const standard = G.standardSurface({ color: 0x331111, metalness: 0, roughness: 1 })
  const { pages, geometry } = quadPages(basic)
  const litPages = pages.map((page) => ({ ...page, material: surfaceOf(standard) }))
  const cam = camera(),
    size: [number, number] = [16, 16]
  const ids = rasterVisibilityIds(pages, identityRoots(), engineCamera(cam), size)
  assert.deepEqual(ids, rasterVisibilityIds(litPages, identityRoots(), engineCamera(cam), size))
  const unlit = shadeVisibility(ids, pages, identityRoots(), engineCamera(cam), size)
  const lit = shadeVisibility(ids, litPages, identityRoots(), engineCamera(cam), size)
  assert.ok(compareImages(unlit, lit).maxChannelError > 0)
  assert.match(DIRECT_LIGHTING_SHADER, /alpha2\s*\/\s*\(PI\*/)
  assert.match(DIRECT_LIGHTING_SHADER, /const PI:f32=3\.14159274;/)
  assert.match(DIRECT_LIGHTING_SHADER, /let Vis=0\.5\/\(gV\+gL\+1e-7\)/)

  geometry.dispose()
  basic.dispose()
  standard.dispose()
})

test('an empty declaration draws as one shared surface: white, opaque, front, unlit', () => {
  const empty = surfaceOf([])
  assert.deepEqual(empty.baseColor, [1, 1, 1])
  assert.equal(empty.lit, false)
  assert.equal(empty.metalness, 0)
  assert.equal(empty.roughness, 1)
  assert.equal(empty.side, 'front')
  assert.equal(empty.alphaTest, 0)
  assert.equal(empty.transmission, 0)
  assert.deepEqual(empty.emissive, [0, 0, 0])
  assert.equal(
    surfaceOf([]),
    empty,
    'an empty declaration reuses a shared record, not allocating per frame',
  )
})
