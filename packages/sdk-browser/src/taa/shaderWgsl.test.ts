import test from 'node:test'
import assert from 'node:assert/strict'
import { taaResolveShader } from './resolveWgsl.ts'
import { TAA_BINDINGS, TAA_VIEW_BYTES } from './bindingsWgsl.ts'
import { PAGE_INFO_STRUCT_WGSL } from '../visibility/shader/pageWgsl.ts'
import { wgslSource } from '../../../math/src/wgsl/source.fixture.ts'
import { PAGE_INFO } from '../visibility/pageInfo.ts'
import { velocityShader } from './velocityWgsl.ts'

/** The history update with an as-is share, the frame's usual one. */
const TAA_SHADER = taaResolveShader(true)
/** The nearest velocity pass, the one that reprojects a surface point. */
const VELOCITY_SHADER = velocityShader()

const occurrences = (text: string, fragment: string) => text.split(fragment).length - 1

test('the temporal shaders assemble each fragment once, on the shared page record', () => {
  for (const fragment of ['fn decodeVector(', 'fn historyRead(', 'fn catmullRomTaps('])
    assert.equal(occurrences(TAA_SHADER, fragment), 1, fragment)
  assert.match(TAA_SHADER, /@vertex fn fullscreen\(/)
  assert.match(TAA_SHADER, /@fragment fn resolve\(/)
  for (const fragment of ['fn placementOf(', 'fn pointBefore(', 'fn encodeVector('])
    assert.equal(occurrences(VELOCITY_SHADER, fragment), 1, fragment)
  // The record carries placement at the word the row writes: that is how the texel finds its
  // object's motion matrix.
  const fields = wgslSource(PAGE_INFO_STRUCT_WGSL)
    .replace(/^.*\{|,\}`?$/g, '')
    .split(',')
  const words: string[] = []
  for (const field of fields) {
    const [name, type] = field.split(':')
    const size = type === 'mat4x4f' ? 16 : type === 'vec4f' ? 4 : type === 'vec2f' ? 2 : 1
    for (let i = 0; i < size; i++) words.push(name)
  }
  assert.equal(words[PAGE_INFO.at.placement], 'placement')
  assert.match(
    VELOCITY_SHADER,
    /fn placementOf\(id:u32\)->u32\{return pages\[visPageIndex\(id\)\]\.placement;\}/,
  )
  assert.match(VELOCITY_SHADER, /motion\[placementOf\(id\)\]/)
})

test('shader bindings are those of the layout, and the uniform has the declared size', () => {
  // The filtered resolve declares every binding, the display layers' four last.
  for (const [name, binding] of Object.entries(TAA_BINDINGS))
    assert.match(
      taaResolveShader(true, false, true),
      new RegExp(`@binding\\(${binding}\\) var(<[a-z,]+>)? ${name}:`),
      `binding ${name}`,
    )
  // Two matrices, then thirteen quadruplets — the level's knobs last (`quality`, `levels.ts`): no
  // filter weights, the window is evaluated where it is read.
  assert.equal(TAA_VIEW_BYTES, 2 * 64 + 13 * 16)
  assert.match(
    TAA_SHADER,
    /struct TaaView\{prevViewProj:mat4x4f,invViewProj:mat4x4f,viewport:vec4f,params:vec4f,render:vec4f,jitter:vec4f,eye:vec4f,exposure:vec4f,parallax:vec4f,rates:vec4f,depth:vec4f,radius:vec4f,prevRender:vec4f,analysisGrid:vec4f,quality:vec4f,\}/,
  )
  assert.doesNotMatch(TAA_SHADER, /view\.weights/)
})

test('the background, at zero depth, reprojects as a direction and not as a point', () => {
  // The homogeneous position is built with the read depth as is: at zero — reversed depth's
  // infinite far plane — the product by the inverse yields a point at infinity, and the
  // reprojection follows it without dividing before the previous matrix.
  assert.match(VELOCITY_SHADER, /transformHomogeneousPoint\(view\.invViewProj,vec3f\(screen,z\)\)/)
  // Neither record nor matrix is read until a placement has moved.
  assert.match(
    VELOCITY_SHADER,
    /if\(view\.params\.z!=0\.0&&!\(id==0u\)\)\{position=motion\[placementOf\(id\)\]\*position;\}/,
  )
  // A point behind the last view is off its screen.
  assert.match(VELOCITY_SHADER, /if\(prev\.w<=0\.0\)\{return TaaMotion\(/)
})

// With no as-is pixel every sample's share is 0, and the history's is clamped to [0, 0]: the
// flag-reading resolve writes 0 wherever its colour is finite. The flagless one writes that 0 and is
// otherwise the same text — the colour and the weights line for line —, reading neither flags nor
// the as-is share history.
test('the flagless resolve is the flag-reading one without its share, written as 0', () => {
  const flagless = taaResolveShader(false)
  assert.doesNotMatch(flagless, /var flags|textureLoad\(flags|shareLo|keptShare/)
  const outputs = (text: string) => [
    ...text.matchAll(/return TaaOut\(color,vec4f\((.*),validity,0\.0,0\.0\)\);$/gm),
  ]
  assert.deepEqual(
    outputs(flagless).map(([, share]) => share),
    ['0.0'],
  )
  assert.equal(outputs(TAA_SHADER).length, 1)
  const flagged = new Set(TAA_SHADER.split('\n'))
  const own = flagless.split('\n').filter((line) => !flagged.has(line))
  assert.equal(own.length, 1, 'only its output is its own')
  const removed = TAA_SHADER.split('\n').filter((line) => !flagless.includes(line))
  for (const line of removed) assert.match(line, /share|var flags|asIs|TaaOut/, line)
})
