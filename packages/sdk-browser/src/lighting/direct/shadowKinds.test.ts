// A lit program compiled for one kind of shadowed light (`ShadowKinds`) holds, in each shadow read,
// the branch of that kind alone, the same text the program with both holds for it: the full program
// is the text from before the kinds, byte for byte (`if(directional)` the sun's clipmap, the rest the
// local light's map), and each read of a variant is that text with the other branch cut out, but
// for the blank in front of it — so a light of a kept kind runs the same code as in the program with
// every code path.
import test from 'node:test'
import assert from 'node:assert/strict'
import { functionsOf } from '../../texture/shaderRule.fixture.ts'
import { directShadowWgsl } from './shadowWgsl.ts'
import { contractLightingShader } from '../deferred/shaders.ts'
import { ALL_SHADOW_KINDS, byShadowKind, shadowKindsOf } from './shadowKinds.ts'

const SUN = { sun: true, local: false },
  LOCAL = { sun: false, local: true }
/** The reads of the resolve (the point read of the transmission) and of the forward passes. */
const READS = [
  { name: 'vsmTransmissionRead', request: 14, traced: false },
  { name: 'vsmShadowFactor', request: null, traced: false },
  { name: 'vsmShadowFiltered', request: null, traced: false },
]
const text = (request: number | null, traced: boolean, kinds = ALL_SHADOW_KINDS) =>
  directShadowWgsl(request, 25, undefined, traced, kinds)
/** The read's text before its branches, its sun's, its local light's. */
const parts = (source: string, name: string) => {
  const body = functionsOf(source, [name])
  const [head, rest] = body.split(' if(directional){\n')
  const [sun, local] = rest.replace(/\n\}\s*$/, '').split('\n }\n')
  return { head, sun, local }
}

test('each read of a variant is the full read with the other kind’s branch cut out', () => {
  for (const { name, request, traced } of READS) {
    const full = parts(text(request, traced), name)
    assert.ok(full.sun.includes('vsmHandleFromIdDirectional(id)'), name)
    assert.ok(!full.sun.includes('vsmHandleFromId(id)'), name)
    assert.ok(full.local.includes('vsmCubeFace'), name)
    for (const [kinds, keeps, cuts] of [
      [SUN, full.sun, full.local],
      [LOCAL, full.local, full.sun],
    ] as const) {
      const variant = functionsOf(text(request, traced, kinds), [name])
      assert.equal(variant, `${full.head} ${keeps}\n}`, `${name} ${JSON.stringify(kinds)}`)
      assert.ok(!variant.includes(cuts), name)
    }
  }
})

test('the traced read walks the rays of the kinds its program holds', () => {
  const read = (kinds = ALL_SHADOW_KINDS) =>
    functionsOf(text(null, true, kinds), ['vsmShadowTraced'])
  assert.ok(read().includes('if(isSun(light)){'))
  const [sun, local] = [read(SUN), read(LOCAL)]
  assert.ok(sun.includes('vsmTraceSun(') && !sun.includes('vsmTraceLocal('))
  assert.ok(local.includes('vsmTraceLocal(') && !local.includes('vsmTraceSun('))
})

test('the kinds a key names; a key that cuts none keeps both', () => {
  assert.deepEqual(shadowKindsOf({}), ALL_SHADOW_KINDS)
  assert.deepEqual(shadowKindsOf({ sunless: true }), LOCAL)
  assert.deepEqual(shadowKindsOf({ localless: true }), SUN)
  assert.equal(byShadowKind(ALL_SHADOW_KINDS, 'S', 'L'), 'if(directional){\nS\n }\nL')
  assert.equal(byShadowKind(SUN, 'S', 'L'), 'S')
  assert.equal(byShadowKind(LOCAL, 'S', 'L'), 'L')
})

test('the resolve is compiled with the kinds its key names', () => {
  const resolve = (kinds = ALL_SHADOW_KINDS) =>
    contractLightingShader(false, false, true, true, kinds)
  const clipmap = /vsmHandleFromIdDirectional\(id\)/,
    cube = /i32\(vsmCubeFace\(/
  assert.match(resolve(), clipmap)
  assert.match(resolve(), cube)
  assert.match(resolve(SUN), clipmap)
  assert.doesNotMatch(resolve(SUN), cube)
  assert.match(resolve(LOCAL), cube)
  assert.doesNotMatch(resolve(LOCAL), clipmap)
})
