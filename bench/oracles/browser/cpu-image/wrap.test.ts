// The CPU image oracle addresses a texture as the samplers do (defects 4 and 8): its map read
// (`sampleLinear`) and its raster's alpha cutout (`rasterVisibility`) keep, on every addressing
// case, the texel the sampler rule names (`tests/gpu/texture/addressingCases.ts`, held against the
// real WebGPU sampler by `texture-addressing.gpu.ts`); and each map of a material whose maps do not
// share a mode is read in its own.
import test from 'node:test'
import assert from 'node:assert/strict'
import { importHostTexture } from '../../../../packages/sdk-browser/src/host/textureImport.ts'
import * as G from '../../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import {
  createEngineCamera,
  readCameraWorld,
} from '../../../../packages/sdk-browser/src/camera/world.ts'
import { surfaceOf } from '../../../../packages/sdk-browser/src/page/surface.ts'
import { identityRoots } from '../../../../packages/sdk-browser/src/page/selection/placements.fixture.ts'
import {
  addressingCases,
  nearestTexel,
  textureBytes,
  type AddressingCase,
} from '../../../../tests/gpu/texture/addressingCases.ts'
import { MAPS, TEXTURE, UV, mixedMaterial } from '../../../../tests/gpu/texture/addressingMaps.ts'
import { sampleLinear } from './math.ts'
import { rasterVisibility } from './raster.ts'

const CASES = addressingCases()
const maps = new Map<string, G.GraphTexture>()
/** The case's texture, one per size and pair of modes. */
function mapOf({ width, height, wrapS, wrapT }: AddressingCase) {
  const key = `${width}x${height}/${wrapS}/${wrapT}`
  if (!maps.has(key))
    maps.set(
      key,
      Object.assign(new G.GraphTexture(), {
        image: { data: textureBytes(width, height), width, height },
        wrapS,
        wrapT,
        flipY: false,
      }),
    )
  return maps.get(key)!
}
/** A texel's indices from the colour read there: red 20 + 40x, green 20 + 40y. */
const texelOf = ([r, g]: number[]) => [
  Math.round((r * 255 - 20) / 40),
  Math.round((g * 255 - 20) / 40),
]
const name = (c: AddressingCase) =>
  `${c.width}x${c.height} S=${c.nameS} T=${c.nameT} uv=(${c.u}, ${c.v})`

test('the oracle map read keeps the texel the sampler rule names, on every case', () => {
  for (const c of CASES)
    assert.deepEqual(
      texelOf(sampleLinear(importHostTexture(mapOf(c)), c.u, c.v)),
      c.expected,
      name(c),
    )
})

test("the oracle raster's alpha cutout reads the texel the sampler rule names", () => {
  // A triangle whose vertex `a` lands exactly on pixel (0, 0), where its weights are (1, 0, 0),
  // carries the case's coordinate as is. A texel's alpha is 10 + 10·rank: bisecting the alpha
  // test finds the rank of the texel read.
  const camera = G.perspectiveCamera()
  camera.projectionMatrix.set(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0.5, 0, 0, -1, 0)
  const view = readCameraWorld(createEngineCamera(), camera)
  const positions = G.floatAttribute([-1, 1, -1, 3, 1, -1, -1, -3, -1], 3)
  for (const c of CASES) {
    const geometry = new G.Geometry()
    geometry.setAttribute('position', positions)
    geometry.setAttribute('uv', G.floatAttribute([c.u, c.v, c.u, c.v, c.u, c.v], 2))
    const material = G.basicSurface({ map: mapOf(c), side: G.DOUBLE_SIDE })
    const page = {
      array: new Uint32Array([0, 1, 2]),
      attributes: geometry.attributes,
      material: surfaceOf(material),
    }
    const kept = (rank: number) => {
      material.alphaTest = (10 + 10 * rank) / 255
      return rasterVisibility([page], identityRoots(), view, [1, 1]).ids[0] !== 0
    }
    assert.ok(kept(0), `${name(c)}: the first texel's alpha keeps the pixel`)
    let low = 0,
      high = c.width * c.height - 1
    while (low < high) {
      const middle = (low + high + 1) >> 1
      if (kept(middle)) low = middle
      else high = middle - 1
    }
    assert.deepEqual([low % c.width, Math.floor(low / c.width)], c.expected, name(c))
  }
})

test('each map of a mixed material is read in its own mode', () => {
  const material = mixedMaterial()
  const image = {
    data: TEXTURE.bytes,
    width: TEXTURE.width,
    height: TEXTURE.height,
  }
  for (const { name: map, slot, wrapS, wrapT } of MAPS) {
    const texture = Object.assign(material[slot] as G.GraphTexture, { image, flipY: false })
    for (const [u, v] of UV)
      assert.deepEqual(
        texelOf(sampleLinear(importHostTexture(texture), u, v)),
        [nearestTexel(u, TEXTURE.width, wrapS), nearestTexel(v, TEXTURE.height, wrapT)],
        `${map} at (${u}, ${v})`,
      )
  }
})
