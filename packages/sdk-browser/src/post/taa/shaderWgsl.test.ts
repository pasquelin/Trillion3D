import test from 'node:test'
import assert from 'node:assert/strict'
import { taaResolveShader } from './resolveWgsl.ts'
import { TAA_BINDINGS, TAA_VIEW_BYTES } from './bindingsWgsl.ts'
import { PAGE_INFO_STRUCT_WGSL } from '../../visibility/shader/pageWgsl.ts'
import { wgslSource } from '../../../../math/src/wgsl/source.fixture.ts'
import { PAGE_INFO } from '../../visibility/pageInfo.ts'
import { VELOCITY_BINDINGS, velocityShader } from './nearestVelocityWgsl.ts'
import { SURFACE_VELOCITY_BINDINGS, SURFACE_VELOCITY_WGSL } from './surfaceVelocityWgsl.ts'
import { RAD2DEG } from '../../../../math/src/constants.ts'
import { IDENTITY_MATRIX4 } from '../../../../math/src/matrix/matrix4.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { builtins } from '../../materials/texture/shaderRunBuiltins.fixture.ts'
import { createTaaFrameState } from './frameState.ts'
import { TAA_VIEW } from './bindingsWgsl.ts'
import { writeTaaView } from './view.ts'

const T = TAA_VIEW.at

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
  // filter weights, the window is evaluated where it is read; the history's laws are constants
  // (`HISTORY_LAWS`).
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

test('the velocity stage writes the vector the temporal pass reads, from the same nearest surface; its analysis writes none', () => {
  const surface = SURFACE_VELOCITY_WGSL
  for (const text of [VELOCITY_SHADER, surface])
    assert.equal(occurrences(text, 'fn nearestSurface('), 1)
  assert.match(
    surface,
    /vectorOut,p,vec4u\(encodeVector\(nearestSurface\(p\)\.motion\.velocity\.xy\),/,
  )
  // The analysis starts from the same surface for its marks and occluders, and leaves the vector to
  // the stage: the motion blur reads it after the pass.
  assert.match(VELOCITY_SHADER, /let nearest=surface\.motion;/)
  assert.doesNotMatch(VELOCITY_SHADER, /vectorOut/)
  for (const gone of ['occluders', 'closestOut', 'marksOut', 'pageOf(', 'scatterOccluder'])
    assert.equal(occurrences(surface, gone), 0, gone)
  // The inputs sit at the same bindings, the vector after them.
  const inputs = [
    ...['view', 'depth', 'ids', 'pages', 'motion', 'indices', 'positions', 'uvs', 'boxes'],
  ] as const
  for (const name of inputs)
    assert.equal(SURFACE_VELOCITY_BINDINGS[name], VELOCITY_BINDINGS[name], name)
  assert.match(surface, /@binding\(9\) var vectorOut:texture_storage_2d<r32uint,write>/)
})

/** A double's two words, high then low, as the roots' world boxes keep them. */
const doubleWords = (value: number) => {
  const words = new Uint32Array(new Float64Array([value]).buffer)
  return [words[1], words[0]]
}

test('an object smaller on the screen than `perObjectSize` is measured as still, none at 0', () => {
  // A placement that moved by itself: its motion is a translation, which draws motion unless the
  // object is left out.
  const moved = new Array(16).fill(0).map((_, at) => (at % 5 === 0 ? 1 : at === 12 ? 0.5 : 0))
  const { device, writes } = fakeDevice(),
    state = createTaaFrameState()
  // A 90 degrees field of view: half the projection's scale is 0.5, the field over 90 degrees 1.
  const projection = new Float64Array(16)
  projection[0] = projection[5] = 1
  const cam = { viewProjection: IDENTITY_MATRIX4, eye: [0, 0, 0], projection, perspective: 1 }
  const small = (percent: number, distance: number, orthographic = false) => {
    state.objectSize = percent
    writeTaaView(device, {} as GPUBuffer, state, cam as never, [64, 32], [64, 32], [64, 32], false)
    const rates = (writes.at(-1)!.data as Float32Array).subarray(T.rates, T.rates + 4)
    // A box of a metre a side at `distance` metres along the first axis, a root of no other.
    const box = [-0.5 + distance, -0.5, -0.5, 0.5 + distance, 0.5, 0.5].map(doubleWords)
    const run = shaderRun<{
      smallObject: (rank: number) => boolean
      drawsMotion: (id: number) => boolean
    }>(SURFACE_VELOCITY_WGSL, ['smallObject', 'drawsMotion'], {
      view: {
        rates: [...rates],
        eye: [0, 0, 0, 0],
        radius: [0, 0, 1, orthographic ? 1 : 0],
        params: [0, 0, 1, 0],
      },
      boxes: [...box, [0, 0]],
      pages: new Proxy([], { get: () => ({ deformOutput: 0, placement: 0 }) }),
      motion: [builtins.mat4x4f(...moved)],
    })
    // The object is left out of the velocity pass as it is measured small: a moving one draws none.
    assert.equal(run.drawsMotion(1), !run.smallObject(0))
    return run.smallObject(0)
  }
  // Its sphere, 0.87 m of radius, takes 0.5 · 0.87 / 10 of the screen at ten metres: a diameter
  // of 8.7 %, under the 10 % asked, and over it at five metres (17 %).
  assert.equal(small(10, 10), true, 'smaller than 10 % of the screen')
  assert.equal(small(10, 5), false, 'larger than it, nearer')
  assert.equal(small(5, 10), false, 'and larger than the 5 % asked')
  assert.equal(small(0, 10), false, 'a size of 0 leaves none out')
  assert.equal(small(10, 10, true), false, 'no foreshortening in an orthographic view')
  assert.equal(small(10, 1000), true, 'far away')
  // The least radius, squared, follows the field of view over 90 degrees: a narrower view asks less.
  projection[0] = 2
  state.objectSize = 10
  writeTaaView(device, {} as GPUBuffer, state, cam as never, [64, 32], [64, 32], [64, 32], false)
  const u = writes.at(-1)!.data as Float32Array
  const fov = (2 * Math.atan(0.5) * RAD2DEG) / 90
  assert.deepEqual([u[T.rates + 2], u[T.rates + 3]], [1, Math.fround((0.05 * fov) ** 2)])
})
