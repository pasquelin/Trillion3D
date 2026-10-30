// The path tracer's hit-material record, packed and read back from the shipped text.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { shadingEnergyWords } from '../../../../sdk-core/src/lighting/shadingEnergy.ts'
import {
  PT_HIT_MATERIAL_BYTES,
  PT_HIT_MATERIAL_WGSL,
  PT_HIT_SURFACE_WGSL,
  PT_MATERIAL_FLAG,
  ptHitMaterialSlotBytes,
} from './hitMaterialWgsl.ts'

type V3 = [number, number, number]
interface Material {
  base: V3
  metallic: number
  specular: number
  roughness: number
  normal: V3
  emission: V3
  opacity: number
  model: number
  ior: number
  fuzz: number
  flags: number
  subsurface: V3
  depth: number
  fuzzColor: V3
  transmission: number
  attenuation: V3
  thickness: number
}
const f16 = (x: number) => {
  // round to half precision
  const h = new Float32Array(1)
  h[0] = x
  const bits = new Uint32Array(h.buffer)[0]
  const sign = bits >>> 31
  const exp = ((bits >>> 23) & 255) - 127
  if (x === 0) return sign << 15
  const e = Math.max(-14, Math.min(15, exp))
  const m = Math.round((Math.abs(x) / 2 ** e - 1) * 1024)
  return (
    (sign << 15) |
    ((e + 15) << 10) |
    (e === -14 && Math.abs(x) < 2 ** -14 ? Math.round(Math.abs(x) * 2 ** 24) : m)
  )
}
const fromF16 = (h: number) => {
  const e = (h >> 10) & 31
  const m = h & 1023
  const v = e === 0 ? m * 2 ** -24 : (1 + m / 1024) * 2 ** (e - 15)
  return h >> 15 ? -v : v
}
const run = () =>
  shaderRun<{
    ptPackHitMaterial: (m: Material) => number[][]
    ptUnpackHitMaterial: (a: number[], b: number[], c: number[]) => Material
  }>(PT_HIT_MATERIAL_WGSL, ['ptPackHitMaterial', 'ptUnpackHitMaterial'], {
    directLights: { energy: shadingEnergyWords() },
    unpack2x16unorm: (w: number) => [(w & 0xffff) / 65535, (w >>> 16) / 65535],
    unpack2x16snorm: (w: number) => [((w << 16) >> 16) / 32767, (w >> 16) / 32767],
    unpack2x16float: (w: number) => [fromF16(w & 0xffff), fromF16(w >>> 16)],
    pack2x16unorm: ([a, b]: number[]) =>
      (Math.round(a * 65535) | (Math.round(b * 65535) << 16)) >>> 0,
    pack2x16snorm: ([a, b]: number[]) =>
      ((Math.round(a * 32767) & 0xffff) | (Math.round(b * 32767) << 16)) >>> 0,
    pack2x16float: ([a, b]: number[]) => (f16(a) | (f16(b) << 16)) >>> 0,
  })

test('a hit material survives the record', () => {
  const m: Material = {
    base: [0.5, 0.25, 0.125],
    metallic: 0.5,
    specular: 0.5,
    roughness: 0.4,
    normal: [0, 0, 1],
    emission: [2, 0, 0.5],
    opacity: 0.75,
    model: 3,
    ior: 1.5,
    fuzz: 0.2,
    flags: 3,
    subsurface: [1, 0.5, 0],
    depth: 1,
    fuzzColor: [0.5, 0.25, 1],
    transmission: 0.75,
    attenuation: [-0.5, -2, -0.125],
    thickness: 0.25,
  }
  const [a, b, c] = run().ptPackHitMaterial(m)
  const back = run().ptUnpackHitMaterial(a, b, c)
  const near = (x: number[], y: number[], eps: number) =>
    x.forEach((v, k) => assert.ok(Math.abs(v - y[k]) <= eps, `${v} ${y[k]}`))
  near(back.base, m.base, 1e-3)
  near(back.emission, m.emission, 1e-3)
  near(back.normal, m.normal, 1e-3)
  near([back.roughness, back.specular, back.metallic, back.opacity], [0.4, 0.5, 0.5, 0.75], 1e-3)
  near([back.ior, back.fuzz], [1.5, 0.2], 0.01)
  near(back.subsurface, m.subsurface, 0.003)
  assert.deepEqual([back.model, back.flags], [3, 3])
  near(back.fuzzColor, m.fuzzColor, 1e-3)
  near(back.attenuation, m.attenuation, 1e-3)
  near([back.transmission, back.thickness], [0.75, 0.25], 1e-3)
})

test('a black medium’s law is held within what a half float stores, so it still takes all the light', () => {
  const m = {
    base: [0, 0, 0],
    metallic: 0,
    specular: 0,
    roughness: 0,
    normal: [0, 0, 1],
    emission: [0, 0, 0],
    opacity: 1,
    model: 0,
    ior: 1.5,
    fuzz: 0,
    flags: 0,
    subsurface: [0, 0, 0],
    depth: 0,
    fuzzColor: [0, 0, 0],
    transmission: 1,
    attenuation: [-(2 ** 64), 0, 0],
    thickness: 0,
  } as Material
  const [a, b, c] = run().ptPackHitMaterial(m)
  const back = run().ptUnpackHitMaterial(a, b, c)
  assert.ok(back.attenuation[0] <= -60000 && Number.isFinite(back.attenuation[0]))
})

test('a subsurface colour is the light a two-sided leaf passes, or added to the diffuse colour, the two scaled together where they sum over one', () => {
  const { ptSurfaceOfHitMaterial } = shaderRun<{
    ptSurfaceOfHitMaterial: (
      m: Material,
      position: V3,
      geo: V3,
      vertexNormal: V3,
      hitT: number,
      front: boolean,
    ) => { diffuse: V3; transmit: V3 }
  }>(PT_HIT_SURFACE_WGSL, ['ptSurfaceOfHitMaterial'], {
    directLights: { energy: shadingEnergyWords() },
    surfaceSpecular: 0.5,
  })
  const base = {
    base: [0.6, 0.6, 0.6],
    metallic: 0,
    specular: 0.5,
    roughness: 0.5,
    normal: [0, 0, 1],
    emission: [0, 0, 0],
    opacity: 1,
    model: 0,
    ior: 1.5,
    fuzz: 0,
    subsurface: [0.6, 0.3, 0.2],
    depth: 0,
    fuzzColor: [0, 0, 0],
    transmission: 0,
    attenuation: [0, 0, 0],
    thickness: 0,
  }
  const leaf = ptSurfaceOfHitMaterial(
    { ...base, flags: PT_MATERIAL_FLAG.scatters | PT_MATERIAL_FLAG.foliage } as Material,
    [0, 0, 0],
    [0, 0, 1],
    [0, 0, 1],
    1,
    true,
  )
  assert.deepEqual(
    leaf.diffuse.map((x) => +x.toFixed(4)),
    [0.5, 0.5, 0.5],
  )
  assert.deepEqual(
    leaf.transmit.map((x) => +x.toFixed(4)),
    [0.5, 0.25, 0.1667],
  )
  const skin = ptSurfaceOfHitMaterial(
    {
      ...base,
      subsurface: [0.2, 0.2, 0.2],
      flags: PT_MATERIAL_FLAG.scatters | PT_MATERIAL_FLAG.subsurface,
    } as Material,
    [0, 0, 0],
    [0, 0, 1],
    [0, 0, 1],
    1,
    true,
  )
  assert.deepEqual(
    skin.diffuse.map((x) => +x.toFixed(4)),
    [0.8, 0.8, 0.8],
  )
  assert.deepEqual(skin.transmit, [0, 0, 0])
})

test('the slot of a path’s material is the layout in use: three vectors, a fourth only with the weight of the slab', () => {
  assert.equal(ptHitMaterialSlotBytes(false), PT_HIT_MATERIAL_BYTES)
  assert.equal(ptHitMaterialSlotBytes(true), PT_HIT_MATERIAL_BYTES + 16)
})
