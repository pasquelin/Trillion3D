// The uniforms of a post-process material's pass: the stencil mask, the blend, the exposure scales, the words written.
import test from 'node:test'
import assert from 'node:assert/strict'
import { material } from '../../../../sdk-core/src/world/material/index.ts'
import {
  blendableOf,
  STENCIL_COMPARES,
  type StencilCompare,
} from '../../../../sdk-core/src/world/material/postProcessMaterial.ts'
import { POST_BLEND, POST_GIVEN, POST_VIEW } from './postLayout.ts'
import {
  blendOf,
  exposureScales,
  stencilMaskOf,
  writePostGiven,
  writePostView,
} from './postParams.ts'
import { postProgramOf } from './postProgram.ts'
import { usablePostProgram } from './postProgram.ts'

/** The test the pass makes: the reference value against the pixel's stencil, by the mask. */
const passes = (compare: StencilCompare, reference: number, held: number) => {
  const mask = stencilMaskOf(compare)
  return (
    ((mask & 1) !== 0 && reference === held) ||
    ((mask & 2) !== 0 && reference < held) ||
    ((mask & 4) !== 0 && reference > held)
  )
}

test('each stencil comparison keeps the pixels the reference value compared so to their stencil', () => {
  const expected: Record<StencilCompare, (r: number, h: number) => boolean> = {
    less: (r, h) => r < h,
    lessEqual: (r, h) => r <= h,
    greater: (r, h) => r > h,
    greaterEqual: (r, h) => r >= h,
    equal: (r, h) => r === h,
    notEqual: (r, h) => r !== h,
    never: () => false,
    always: () => true,
  }
  for (const compare of STENCIL_COMPARES)
    for (const r of [0, 3, 7])
      for (const h of [0, 3, 7])
        assert.equal(passes(compare, r, h), expected[compare](r, h), `${compare} ${r} ${h}`)
})

test('without an output alpha the colour replaces the pixel and its alpha stays', () => {
  assert.equal(blendOf(material.postProcess(), false, true), POST_BLEND.rgbOnly)
})

test('with an output alpha a transparent material blends by its blending, an opaque one replaces', () => {
  const blend = (blending: string, transparent = true, allow = true) =>
    blendOf(material.postProcess({ blending, transparent } as never), true, allow)
  assert.equal(blend('normal'), POST_BLEND.translucent)
  assert.equal(blend('additive'), POST_BLEND.additive)
  assert.equal(blend('multiply'), POST_BLEND.modulate)
  assert.equal(blend('alphaComposite'), POST_BLEND.alphaComposite)
  assert.equal(blend('alphaHoldout'), POST_BLEND.alphaHoldout)
  assert.equal(blend('normal', false), POST_BLEND.replace)
  assert.equal(blend('normal', true, false), POST_BLEND.replace, 'blend modes not allowed')
})

test('the exposure scales apply before the tone mapping unless the material turns them off', () => {
  const at = (props: object) => blendableOf(material.postProcess(props))
  assert.deepEqual(exposureScales(at({ blendableLocation: 'sceneColorBeforeBloom' }), 4), [4, 0.25])
  assert.deepEqual(exposureScales(at({}), 4), [1, 1], 'after the tone mapping')
  assert.deepEqual(
    exposureScales(
      at({ blendableLocation: 'sceneColorBeforeBloom', disablePreExposureScale: true }),
      4,
    ),
    [1, 1],
  )
})

test('the frame uniform holds the depth terms, the sizes and the scales', () => {
  const out = new Float32Array(POST_VIEW.words)
  const projection = new Float64Array(16)
  projection[0] = 1
  projection[5] = 1
  projection[11] = -1
  projection[14] = 0.1
  writePostView(
    out,
    {
      projection,
      perspective: true,
      image: [640, 360, 1024, 512],
      scene: [640, 360, 1024, 512],
      custom: [640, 360],
    },
    [2, 0.5],
  )
  assert.deepEqual(
    Array.from(out.slice(POST_VIEW.image, POST_VIEW.image + 4)),
    [640, 360, 1024, 512],
  )
  assert.deepEqual(Array.from(out.slice(POST_VIEW.custom, POST_VIEW.custom + 2)), [640, 360])
  assert.deepEqual(Array.from(out.slice(POST_VIEW.head, POST_VIEW.head + 2)), [2, 0.5])
  assert.equal(out[POST_VIEW.depth + 1], Math.fround(0.1))
})

test('a material uniform holds the clocks, the plain colour, the flags and the mixed values of the graph', () => {
  const g = material.graph('postProcess')
  g.output('emissive', g.channel(g.vectorParameter('tint', [0, 0, 0, 1]), 'rgb'))
  g.set('tint', [1, 1, 1])
  const m = material.postProcess({
    graph: g,
    stencilCompare: 'equal',
    stencilRefValue: 9,
    opacity: 0.25,
  })
  const program = usablePostProgram(m)!
  assert.ok(program === postProgramOf(m))
  const out = new ArrayBuffer(program.bytes)
  writePostGiven(
    out,
    m,
    blendableOf(m),
    { blend: POST_BLEND.translucent, stencil: true },
    { time: 3, realTime: 5 },
    program,
    0.5,
  )
  const f = new Float32Array(out)
  const u = new Uint32Array(out)
  assert.deepEqual(Array.from(f.slice(POST_GIVEN.head, POST_GIVEN.head + 2)), [3, 5])
  assert.equal(f[POST_GIVEN.plain + 3], 0.25)
  assert.deepEqual(Array.from(u.slice(POST_GIVEN.flags, POST_GIVEN.flags + 4)), [
    POST_BLEND.translucent,
    1,
    1,
    9,
  ])
  // Half way between the node's neutral (0, 0, 0) and the value written (1, 1, 1).
  assert.deepEqual(Array.from(f.slice(POST_GIVEN.words, POST_GIVEN.words + 4)), [0.5, 0.5, 0.5, 1])
})
