// The resolve writes its storage texel beside the surfaces — the thin transmission — once, never
// twice (zero first, then the value). In one invocation the last write of a texel wins, so
// writing only the last value, once, leaves the texel as it was.
import test from 'node:test'
import assert from 'node:assert/strict'
import { SHADE_SHADER } from './shadeWgsl.ts'

/** The text of WGSL function `name` of the resolve, to its closing brace. */
const bodyOf = (name: string) => {
  const at = SHADE_SHADER.indexOf(`fn ${name}(`)
  return SHADE_SHADER.slice(at, SHADE_SHADER.indexOf('\n}\n', at))
}

test('shade_cs writes the storage texel exactly once, after the resolve, which writes none', () => {
  const entry = bodyOf('shade_cs'),
    resolve = bodyOf('shadeSurface'),
    surface = bodyOf('shadePageSurface')
  assert.equal(entry.match(/storeSubsurface\(/g)?.length, 1)
  assert.ok(entry.indexOf('shadeSurface(') < entry.indexOf('storeSubsurface('))
  // A lane with no pixel of its class leaves before any read or write.
  assert.ok(entry.indexOf('if(!shadesPixel(at)){return;}') < entry.indexOf('shadeSurface('))
  assert.doesNotMatch(resolve, /storeSubsurface\(/)
  assert.doesNotMatch(surface, /storeSubsurface\(/)
  // Its value is the invocation's private variable, zero at its start; two paths set it, once each: the shading model the material
  // names (`materialModelWgsl.ts`) and the thin sheet.
  assert.ok(SHADE_SHADER.includes('var<private> thinOut:vec3f;'))
  assert.equal(surface.split('thinOut=').length, 3)
})

test('the thin transmission keeps its zero or its colour, written once', () => {
  // The surface of a page (`shadePageSurface`) sets it, `shadeSurface` marks the surface it returns.
  const resolve = bodyOf('shadePageSurface')
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
