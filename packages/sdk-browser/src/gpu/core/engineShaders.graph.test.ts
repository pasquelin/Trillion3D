// The modules of the engine that place a vertex hold a graph's offset (`engineShaders.wpo.fixture.ts`):
// the default of none everywhere else, the real hook only where the module is made with offsets, and
// an offset that reads a texture reads it at an explicit level, which a vertex stage allows.
import test from 'node:test'
import assert from 'node:assert/strict'
import { ENGINE_SHADERS } from './engineShaders.fixture.ts'

test('every module that places a page vertex holds the default of no offset, the real hook only where it is made with offsets', () => {
  const hook =
    /fn pageWpoLocal\(page:PageInfo,h:ClusterHeader,vertex:u32,local:vec3f,previous:bool,before:mat4x4f\)->vec3f\{/g
  let placing = 0
  for (const [name, text] of Object.entries(ENGINE_SHADERS)) {
    if (!text.includes('fn pagePosition(')) continue
    placing++
    const declared = text.match(hook)?.length ?? 0
    assert.equal(declared, 1, `${name} declares the hook once`)
    // The default is one line returning zero; the real one reads its row’s record.
    const real = text.includes('let word=materialGraphWord(page.material);')
    assert.equal(real, /(^|_)WPO(_|$)/.test(name), name)
  }
  assert.ok(placing > 10, 'the modules that place a page vertex were found')
})

test('an offset that reads a texture reads it by the colour read at an explicit level, in every module that places a vertex from it', () => {
  const offsetOf = (text: string) => {
    const at = text.search(/fn mgWorldPositionOffset\w*\(/)
    return text.slice(at, text.indexOf('\nfn ', at + 5))
  }
  const textured = Object.entries(ENGINE_SHADERS).filter(([name]) => name.endsWith('_WPO_TEXTURED'))
  assert.ok(textured.length >= 7, 'the vertex stages that bind the atlas were found')
  for (const [name, text] of textured) {
    const body = offsetOf(text)
    assert.match(body, /colorSample\(/, `${name} reads the texture`)
    assert.ok(!/textureSample\(|dpdx|dpdy/.test(body), `${name} reads no derivative`)
    assert.match(text, /textureSampleLevel\(/, `${name} reads at a level`)
  }
  // The offset that reads none holds no read of the atlas.
  assert.ok(!/colorSample\(/.test(offsetOf(ENGINE_SHADERS.VIS_WPO)))
})
