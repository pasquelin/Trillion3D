// S9: the resolve wrote its two storage texels — the thin transmission and the shadow receiver —
// twice where it found them: zero first, then the value. In one invocation the last write of a
// texel wins, so writing only the last value, once, leaves every texel as it was.
import test from 'node:test'
import assert from 'node:assert/strict'
import { SHADE_SHADER } from './shadeWgsl.ts'
import { receiverStoreWgsl } from './receiverTargetWgsl.ts'
import { integers } from '../../texture/integerVectors.fixture.ts'
import { shaderRun } from '../../texture/shaderRun.fixture.ts'

/** The text of WGSL function `name` of the resolve, to its closing brace. */
const bodyOf = (name: string) => {
  const at = SHADE_SHADER.indexOf(`fn ${name}(`)
  return SHADE_SHADER.slice(at, SHADE_SHADER.indexOf('\n}\n', at))
}

test('shade_fs writes each storage texel exactly once, after the resolve, which writes none', () => {
  const entry = bodyOf('shade_fs'),
    resolve = bodyOf('shadeSurface')
  assert.equal(entry.match(/storeReceiver\(/g)?.length, 1)
  assert.equal(entry.match(/storeSubsurface\(/g)?.length, 1)
  assert.ok(entry.indexOf('shadeSurface(pos,id)') < entry.indexOf('storeSubsurface('))
  assert.ok(entry.indexOf('if(!classAdmits(id)){discard;}') < entry.indexOf('shadeSurface('))
  assert.doesNotMatch(resolve, /store(?:Receiver|Subsurface)\(/)
  // Their values are the invocation's private variables, zero at its start; one path sets each.
  for (const name of ['thinOut', 'rcvOffset', 'rcvPlane'])
    assert.ok(SHADE_SHADER.includes(`var<private> ${name}:vec3f;`), name)
  for (const set of ['thinOut=', 'rcvOffset=', 'rcvPlane='])
    assert.equal(resolve.split(set).length, 2, set)
})

test('every way out of the resolve leaves the receiver word the double write left', () => {
  let texel: number[] = []
  const { storeReceiver } = shaderRun<{
    storeReceiver: (pos: number[], offset: number[], plane: number[]) => void
  }>(receiverStoreWgsl(0), ['storeReceiver', 'receiverOct'], {
    receiverOutput: {},
    textureDimensions: () => [8, 8],
    textureStore: (_target: object, _at: number[], value: number[]) => void (texel = value),
    vec3i: integers(3, false),
    vec4u: integers(4, true),
  })
  const resolve = bodyOf('shadeSurface'),
    setAt = resolve.indexOf('rcvOffset=')
  // Each return of the resolve, by the text: those before the receiver is set never set it.
  const returns = [...resolve.matchAll(/return /g)].map(({ index }) => index)
  assert.ok(
    returns.length >= 9,
    'the empty surface, the diagnostic modes, the as-is models, the lit',
  )
  const zero = [0, 0, 0],
    offset = [0.01, -0.02, 0.005],
    plane = [0, 0.3, 0.4]
  for (const at of returns) {
    // Before it, the receiver is never set; after, it is set unless the page is a sprite or a line
    // or has no vertex normal.
    for (const sets of at > setAt ? [false, true] : [false]) {
      // Before: zero, then the value where the resolve found one.
      storeReceiver([2.5, 1.5], zero, zero)
      if (sets) storeReceiver([2.5, 1.5], offset, plane)
      const twice = texel
      // Now: the value or zero, once.
      texel = []
      storeReceiver([2.5, 1.5], sets ? offset : zero, sets ? plane : zero)
      assert.deepEqual(texel, twice, `return at ${at}, receiver ${sets}`)
    }
  }
  assert.ok(
    returns.some((at) => at > setAt),
    'a return after the receiver is set',
  )
})

test('the thin transmission keeps its zero or its colour, written once', () => {
  const resolve = bodyOf('shadeSurface')
  // Set only on its last path, as its write was: `any(thin>0)` or the zero.
  assert.match(resolve, /if\(any\(thin>vec3f\(0\.0\)\)\)\{thinOut=thin;/)
  assert.ok(resolve.indexOf('thinOut=') > resolve.lastIndexOf('return SurfaceOut(vec4f(rgb,0.0)'))
  // The subsurface store: one value a texel, so the last of the two writes is the one kept.
  const writes: number[][] = []
  const store = (color: number[]) => writes.push([...color, 1])
  for (const thin of [
    [0, 0, 0],
    [0.2, 0.5, 0.1],
  ]) {
    writes.length = 0
    store([0, 0, 0])
    if (thin.some((x) => x > 0)) store(thin)
    const twice = writes.at(-1)
    writes.length = 0
    store(thin)
    assert.deepEqual(writes, [twice])
  }
})
