import test from 'node:test'
import assert from 'node:assert/strict'
import { taaReprojectWgsl, taaShader } from './shaderWgsl.ts'
import { TAA_SHADER } from '../gpu/core/shaderTexts.fixture.ts'
import { TAA_BINDINGS, TAA_VIEW_BYTES } from './bindingsWgsl.ts'
import { TAA_DEFORM_WGSL } from './deformWgsl.ts'
import { PAGE_INFO_STRUCT_WGSL } from '../visibility/shader/pageWgsl.ts'
import { TAA_WEIGHTS } from './filterWeights.ts'
import { YCOCG_WGSL } from './ycocgWgsl.ts'
import { ROW_PLACEMENT_WORD } from '../webgpu/row/rowPlacement.ts'
import { REFLECTION_RESOLVE_WGSL } from '../reflections/resolveWgsl.ts'
import { REFLECTION_SOURCE_WGSL } from '../reflections/sourceWgsl.ts'
import { wgslSource } from '../../../math/src/wgsl/source.fixture.ts'

const TAA_REPROJECT_WGSL = taaReprojectWgsl().text

const occurrences = (text: string, fragment: string) => text.split(fragment).length - 1

test('the temporal shader assembles each fragment once, on the shared page record', () => {
  for (const fragment of [wgslSource(YCOCG_WGSL), TAA_REPROJECT_WGSL])
    assert.equal(occurrences(TAA_SHADER, fragment), 1)
  assert.match(TAA_SHADER, /@vertex fn fullscreen\(/)
  assert.match(TAA_SHADER, /@fragment fn resolve\(/)
  // The record carries placement at the word the row writes: that is how the pixel finds
  // its object's motion matrix.
  const fields = wgslSource(PAGE_INFO_STRUCT_WGSL)
    .replace(/^.*\{|,\}`?$/g, '')
    .split(',')
  const words: string[] = []
  for (const field of fields) {
    const [name, type] = field.split(':')
    const size = type === 'mat4x4f' ? 16 : type === 'vec4f' ? 4 : type === 'vec2f' ? 2 : 1
    for (let i = 0; i < size; i++) words.push(name)
  }
  assert.equal(words[ROW_PLACEMENT_WORD], 'placement')
  assert.match(
    TAA_REPROJECT_WGSL,
    /fn placementOf\(id:u32\)->u32\{return pages\[\(id>>8u\)-1u\]\.placement;\}/,
  )
  assert.match(TAA_REPROJECT_WGSL, /motion\[placementOf\(id\)\]/)
})

test('shader bindings are those of the layout, and the uniform has the declared size', () => {
  // The filtered resolve declares every binding, the display layers' four last.
  for (const [name, binding] of Object.entries(TAA_BINDINGS))
    assert.match(
      taaShader(true, false, true),
      new RegExp(`@binding\\(${binding}\\) var(<[a-z,]+>)? ${name}:`),
      `binding ${name}`,
    )
  // Two matrices, viewport and params, the nine weights in three quadruplets, render grid,
  // jitter, eye, exposure, the camera's parallax and the flicker rates.
  assert.equal(TAA_VIEW_BYTES, 2 * 64 + 2 * 16 + TAA_WEIGHTS * 4 + 6 * 16)
  assert.match(
    TAA_SHADER,
    /struct TaaView\{prevViewProj:mat4x4f,invViewProj:mat4x4f,viewport:vec4f,params:vec4f,weights:array<vec4f,3>,render:vec4f,jitter:vec4f,eye:vec4f,tsr:vec4f,parallax:vec4f,moire:vec4f,\}/,
  )
  // No cosine per pixel: weights come from the uniform, neighbour by neighbour. Only a deformed
  // pixel's waves take one (`deformWgsl.ts`).
  assert.doesNotMatch(TAA_SHADER.replace(TAA_DEFORM_WGSL.text, ''), /cos\(/)
  assert.match(TAA_SHADER, /view\.weights\[k>>2u\]\[k&3u\]/)
})

test('the background, at zero depth, reprojects as a direction and not as a point', () => {
  // Homogeneous position is built with the read depth as-is: at zero — reversed depth's
  // infinite far plane — the product by the inverse yields a point at infinity, and
  // reprojection follows it without ever dividing before the previous matrix.
  assert.match(TAA_REPROJECT_WGSL, /view\.invViewProj\*vec4f\(ndc,depthValue,1\.0\)/)
  // Neither record nor matrix is read until a placement has moved; the identifier is the one the
  // resolve read once for its tag.
  assert.match(
    TAA_REPROJECT_WGSL,
    /if\(view\.params\.z!=0\.0&&id!=0u\)\{position=motion\[placementOf\(id\)\]\*position;\}/,
  )
  assert.doesNotMatch(TAA_REPROJECT_WGSL, /textureLoad\(ids/)
  assert.match(TAA_REPROJECT_WGSL, /if\(previous\.w<=0\.0\)\{return vec4f\(0\.0\);\}/)
})

// With no as-is pixel every neighbour's share is 0, and history is clamped to [0, 0]: the
// flag-reading resolve writes 0 wherever its colour is finite. The flagless one writes that 0 and
// is otherwise the same text — the colour and the geometry line for line —, reading neither flags
// nor the as-is share history.
test('the flagless resolve is the flag-reading one without its share, written as 0', () => {
  const flagless = taaShader(false)
  assert.doesNotMatch(flagless, /var flags|textureLoad\(flags|sharePast|shareLo|keptShare/)
  const outputs = (text: string) => [
    ...text.matchAll(
      /TaaOut\((.*),vec4f\((.*),gradient\*[\d.]+\+[\d.]+,0\.0,historyCount\/16\.0\),geometry,moire\);\}?$/gm,
    ),
  ]
  const kept = outputs(TAA_SHADER),
    zero = outputs(flagless)
  assert.equal(zero.length, 3)
  assert.deepEqual(
    zero.map(([, color, share]) => [color, share]),
    kept.map(([, color]) => [color, '0.0']),
    'the same colour, a share of 0',
  )
  const flagged = new Set(TAA_SHADER.split('\n'))
  const own = flagless.split('\n').filter((line) => !flagged.has(line))
  assert.equal(own.length, 3, 'only its three outputs are its own')
  for (const line of own)
    assert.match(
      line,
      /TaaOut\(.*,vec4f\(0\.0,gradient\*[\d.]+\+[\d.]+,0\.0,historyCount\/16\.0\),geometry,moire\);\}?$/,
    )
  const removed = TAA_SHADER.split('\n').filter((line) => !flagless.includes(line))
  for (const line of removed) assert.match(line, /share|var flags|asIs|TaaOut/, line)
})

// `previousUv` takes the identifier its caller read once, never the texel to read it at: the
// reflections' reprojections hand it theirs, as the resolve does.
test('every reprojection hands previousUv the identifier it read', () => {
  for (const shader of [TAA_SHADER, REFLECTION_RESOLVE_WGSL, REFLECTION_SOURCE_WGSL]) {
    const calls = [...shader.matchAll(/previous(?:Uv|Sample)\(([^()]*(?:\([^()]*\))?[^()]*)\)/g)]
      .map((call) => call[1].split(',').at(-1))
      .filter((last) => last !== 'id:u32')
    assert.ok(calls.length > 0)
    for (const last of calls) assert.equal(last, 'id')
  }
})
