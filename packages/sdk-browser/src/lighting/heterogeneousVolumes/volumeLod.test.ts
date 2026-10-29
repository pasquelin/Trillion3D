// The continuous level of detail and the baked grid's kernel.
import test from 'node:test'
import assert from 'node:assert/strict'
import { calcLod, lodFactor, NO_LOD, worldBoundsOf } from './volumeLod.ts'
import { HV_BAKE_WGSL } from './preshadingBakeWgsl.ts'
import { HV_PRESHADING_MIPS_WGSL, mipDispatchOf } from './preshadingMips.ts'
import { dropHeld, type State } from './liveShadingState.ts'
import { lightingCacheResolution, volumeResolutionOf } from './liveShadingGpu.ts'

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
// A projection whose sides contain the points in front of the eye on -z.
const viewProjection = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0]
const view = {
  eye: [0, 0, 0],
  viewProjection,
  tanHalfFov: 1,
  viewWidth: 1000,
  downsample: 1,
  near: 0.1,
}
const at = (z: number) =>
  worldBoundsOf([...identity.slice(0, 12), 0, 0, z, 1], [0, 0, 0], [1, 1, 1])

test('the level is zero near the view, grows with the distance and stops at the coarsest', () => {
  const base = { view, voxelsMin: 64, mipBias: 0, bias: 0, enabled: true }
  const near = calcLod({ ...base, bounds: at(-2) })
  const far = calcLod({ ...base, bounds: at(-400) })
  assert.equal(near.lod, 0)
  assert.ok(far.lod > near.lod && far.lod <= 6)
  assert.equal(lodFactor(near), 1)
})

test('a volume behind the view takes the coarsest level, a disabled level none', () => {
  const base = { view, voxelsMin: 64, mipBias: 0, bias: 0 }
  assert.equal(calcLod({ ...base, bounds: at(50), enabled: true }).lod, 6)
  assert.deepEqual(calcLod({ ...base, bounds: at(-2), enabled: false }), NO_LOD)
})

test('the lighting cache is coarsened by the factor and held to 1/8', () => {
  assert.deepEqual(lightingCacheResolution([64, 64, 64], 0, 2, 2), [16, 16, 16])
  assert.deepEqual(lightingCacheResolution([64, 64, 64], 0, 0.01), [512, 512, 512])
})

test('the volume resolution takes the axes the settings override, held to 1024', () => {
  const settings = (f: string) => (f.endsWith('X') ? 2000 : f.endsWith('Y') ? 8 : 0)
  assert.deepEqual(volumeResolutionOf([64, 64, 64], settings as never), [1024, 8, 64])
})

test('the bake kernel writes one of the three outputs and keeps no backtick', () => {
  assert.match(HV_BAKE_WGSL.text, /fn hvBakeMain/)
  assert.match(HV_BAKE_WGSL.text, /hvSampleExtinction/)
  assert.equal(HV_BAKE_WGSL.text.includes('`'), false)
})

test('an orthographic view gives the level its pixels give at any distance', () => {
  const base = { voxelsMin: 64, mipBias: 0, bias: 0, enabled: true }
  const ortho = { ...view, orthographic: true, tanHalfFov: 4 }
  const near = calcLod({ ...base, view: ortho, bounds: at(-2) })
  const far = calcLod({ ...base, view: ortho, bounds: at(-400) })
  assert.equal(near.lod, far.lod)
})

test('an explicit cache factor is held to 1/8 as the default one is', () => {
  assert.deepEqual(lightingCacheResolution([64, 64, 64], 0.01, 2), [512, 512, 512])
})

test('dropHeld lets go of the resources a predicate names', () => {
  const destroyed: string[] = []
  const entry = (key: string) => [key, { destroy: () => destroyed.push(key) }] as const
  const held = {
    buffers: new Map([entry('grid a'), entry('keep')]),
    steps: new Map([entry('beer 0 0')]),
    caches: new Map([entry('grid shadow debug x')]),
  } as unknown as State
  dropHeld(held, (key) => key.startsWith('grid ') || key.startsWith('beer'))
  assert.deepEqual(destroyed.sort(), ['beer 0 0', 'grid a', 'grid shadow debug x'])
  assert.deepEqual([...held.buffers.keys()], ['keep'])
})

test('the mips of a baked texture are dispatched over each level halved, held to 1, in blocks of four', () => {
  assert.deepEqual(mipDispatchOf([64, 32, 5], 1), { resolution: [32, 16, 2], groups: [8, 4, 1] })
  assert.deepEqual(mipDispatchOf([64, 32, 5], 3), { resolution: [8, 4, 1], groups: [2, 1, 1] })
  assert.deepEqual(mipDispatchOf([3, 3, 3], 4).resolution, [1, 1, 1])
  assert.equal(HV_PRESHADING_MIPS_WGSL.includes('`'), false)
  assert.match(HV_PRESHADING_MIPS_WGSL, /textureSampleLevel\(upper,mipSampler,uvw,0\.0\)/)
})
