// A lit program compiled for one kind of shadowed light (`ShadowKinds`) holds, in each shadow read,
// the branch of that kind alone, the same text the program with both holds for it: the full program
// is the text with no kind selection, byte for byte (`if(directional)` the sun's clipmap, the rest
// the local light's map), and each read of a variant is that text with the other branch cut out,
// but for the blank in front of it — so a light of a kept kind runs the same code as in the program
// with every code path.
import test from 'node:test'
import assert from 'node:assert/strict'
import { functionsOf } from '../../texture/shaderRule.fixture.ts'
import { directShadowWgsl } from './shadowWgsl.ts'
import { ALL_SHADOW_KINDS, byShadowKind, shadowKindsOf } from './shadowKinds.ts'
import { contractLightingShader } from '../../gpu/core/shaderTexts.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'

const SUN = { sun: true, local: false },
  LOCAL = { sun: false, local: true }
/** The located read (`vsmLocate`) of the resolve (its transmission) and of the forward passes. */
const REQUESTS = [14, null]
const text = (request: number | null, kinds = ALL_SHADOW_KINDS) =>
  wgslModule(directShadowWgsl(25, { resolveTransmission: request, kinds }))
/** The read's text before its branches, its sun's, its local light's. */
const parts = (source: string) => {
  const body = functionsOf(source, ['vsmLocate'])
  const [head, rest] = body.split(' if(directional){\n')
  const [sun, local] = rest.replace(/\n\}\s*$/, '').split('\n }\n')
  return { head, sun, local }
}

test('each read of a variant is the full read with the other kind’s branch cut out', () => {
  for (const request of REQUESTS) {
    const full = parts(text(request))
    assert.ok(full.sun.includes('vsmHandleFromIdDirectional(id)'), `${request}`)
    assert.ok(!full.sun.includes('vsmHandleFromId(id)'), `${request}`)
    assert.ok(full.local.includes('vsmCubeFace'), `${request}`)
    for (const [kinds, keeps, cuts] of [
      [SUN, full.sun, full.local],
      [LOCAL, full.local, full.sun],
    ] as const) {
      const variant = functionsOf(text(request, kinds), ['vsmLocate'])
      assert.equal(variant, `${full.head} ${keeps}\n}`, `${request} ${JSON.stringify(kinds)}`)
      assert.ok(!variant.includes(cuts), `${request}`)
    }
  }
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
    contractLightingShader(false, {
      sunless: !kinds.sun,
      localless: !kinds.local,
      lobeless: true,
    })
  const clipmap = /vsmHandleFromIdDirectional\(id\)/,
    cube = /i32\(vsmCubeFace\(/
  assert.match(resolve(), clipmap)
  assert.match(resolve(), cube)
  assert.match(resolve(SUN), clipmap)
  assert.doesNotMatch(resolve(SUN), cube)
  assert.match(resolve(LOCAL), cube)
  assert.doesNotMatch(resolve(LOCAL), clipmap)
})
