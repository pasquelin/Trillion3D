import test from 'node:test'
import assert from 'node:assert/strict'
import { taaResolveShader } from './resolveWgsl.ts'
import { TAA_BINDINGS, TAA_VIEW_BYTES } from './bindingsWgsl.ts'
import { PAGE_INFO_STRUCT_WGSL } from '../../visibility/shader/pageWgsl.ts'
import { wgslSource } from '../../../../math/src/wgsl/source.fixture.ts'
import { PAGE_INFO } from '../../visibility/pageInfo.ts'
import { VELOCITY_BINDINGS, velocityShader } from './nearestVelocityWgsl.ts'
import { SURFACE_VELOCITY_BINDINGS, SURFACE_VELOCITY_WGSL } from './surfaceVelocityWgsl.ts'
import { VELOCITY_INPUT_BINDINGS } from './nearestSurfaceWgsl.ts'
import { velocityInputEntries } from './inputs.ts'

/** The history update, the one of every frame. */
const TAA_SHADER = taaResolveShader()
/** The nearest velocity pass, the one that reprojects a surface point. */
const VELOCITY_SHADER = velocityShader()

const occurrences = (text: string, fragment: string) => text.split(fragment).length - 1

test('the temporal shaders assemble each fragment once, on the shared page record', () => {
  for (const fragment of ['fn decodeVector(', 'fn historyRead(', 'fn catmullRomTaps('])
    assert.equal(occurrences(TAA_SHADER, fragment), 1, fragment)
  assert.match(TAA_SHADER, /@compute @workgroup_size\(64\)\nfn resolve\(/)
  assert.doesNotMatch(TAA_SHADER, /@vertex|@fragment/, 'a dispatch over the history, no draw')
  // The stage finds the object's motion; the analysis only reads the vector the stage wrote.
  for (const fragment of ['fn placementOf(', 'fn pointBefore(', 'fn encodeVector('])
    assert.equal(occurrences(SURFACE_VELOCITY_WGSL, fragment), 1, fragment)
  assert.equal(occurrences(VELOCITY_SHADER, 'fn decodeVector('), 1)
  for (const fragment of ['fn placementOf(', 'fn pointBefore('])
    assert.equal(occurrences(VELOCITY_SHADER, fragment), 0, fragment)
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
  // The speed is taken in the update's precision (`f32` here, `f16` in the 16-bit program).
  assert.match(
    TAA_SHADER,
    /let speed=f32\(length\(vector\*view\.viewport\.xy\)\);/,
    'the motion clamp speed',
  )
  assert.match(
    SURFACE_VELOCITY_WGSL,
    /fn placementOf\(id:u32\)->u32\{return pages\[visPageIndex\(id\)\]\.placement;\}/,
  )
  // The nearest pass reads the vector the stage wrote; it computes no placement motion itself.
  for (const gone of ['placementMoved', 'placementMotion', 'texelMotion', 'drawsMotion'])
    assert.equal(occurrences(VELOCITY_SHADER, gone), 0, gone)
})

test('shader bindings are those of the layout, and the uniform has the declared size', () => {
  // The filtered update that writes the half-size image declares every binding, the display layers'
  // four and their two outputs last.
  const filtered = taaResolveShader(true, 'rgba16float', { half: true })
  for (const [name, binding] of Object.entries(TAA_BINDINGS))
    assert.match(
      filtered,
      new RegExp(`@binding\\(${binding}\\) var(<[a-z,]+>)? ${name}:`),
      `binding ${name}`,
    )
  for (const [layer, binding] of Object.entries({ tint: 21, add: 22 }))
    assert.match(filtered, new RegExp(`@binding\\(${binding}\\) var ${layer}Out:`), layer)
  // Two matrices, then thirteen quadruplets — the level's knobs and the pre-exposure's ratio
  // (`quality`, `preExposure`, which holds the flicker rates too) —, then the history's laws and scale, the resurrection's terms and
  // grid (`history`, `fraction`, `resurrection`, `resurrectGrid`), the thin geometry detection's
  // thresholds (`thin`, `thinFade`) and the matrix to the frame a pixel is resurrected from: no
  // filter weights, the window is evaluated where it is read. Then the eye in doubles, at which the
  // velocity stage takes a placement's two poses (`placementMotion`), and last the inverse of the
  // matrix to the last view (`prevInvViewProj`), a fourth matrix.
  assert.equal(TAA_VIEW_BYTES, 4 * 64 + 19 * 16 + 2 * 16)
  assert.match(
    TAA_SHADER,
    /struct TaaView\{prevViewProj:mat4x4f,invViewProj:mat4x4f,viewport:vec4f,params:vec4f,render:vec4f,jitter:vec4f,eye:vec4f,parallax:vec4f,rates:vec4f,depth:vec4f,radius:vec4f,prevRender:vec4f,analysisGrid:vec4f,quality:vec4f,preExposure:vec4f,history:vec4f,fraction:vec4f,resurrection:vec4f,resurrectGrid:vec4f,thin:vec4f,thinFade:vec4f,toResurrection:mat4x4f,exactEye:array<vec4u,2>,prevInvViewProj:mat4x4f,\}/,
  )
  assert.doesNotMatch(TAA_SHADER, /view\.weights/)
})

test('the background, at zero depth, reprojects as a direction and not as a point', () => {
  // The homogeneous position is built with the read depth as is: at zero — reversed depth's
  // infinite far plane — the product by the inverse yields a point at infinity, and the
  // reprojection follows it without dividing before the previous matrix.
  assert.match(VELOCITY_SHADER, /transformHomogeneousPoint\(view\.invViewProj,vec3f\(screen,z\)\)/)
  // The nearest pass reads the velocity as the stage wrote it, one texel, and measures a static
  // surface by the camera's alone: no record, no pose matrix.
  assert.match(VELOCITY_SHADER, /fn velocityAt\(p:vec2i,at:vec2i,z:f32\)->vec4f\{/)
  assert.match(VELOCITY_SHADER, /return vec4f\(cameraMotion\(screenOfTexel\(p\),z\),0\.0\);/)
  // A point behind the last view is off its screen.
  assert.match(
    VELOCITY_SHADER,
    /if\(prev\.w<=0\.0\)\{return vec3f\(screen\+vec2f\(4\.0\),0\.0\);\}/,
  )
})

// The history's metadata is its validity alone: the as-is pixels of a debug view are composed
// after the temporal pass, so no update reads a flag nor keeps an as-is share (it stored the share in red, the validity in green, and had a flag-reading update).
test('the update stores the validity alone in red, and reads no flag', () => {
  assert.doesNotMatch(TAA_SHADER, /var flags|textureLoad\(flags|shareLo|keptShare/)
  // The validity is converted to the stored 32-bit vector, the update computing in its precision
  // (16 bits where granted).
  assert.equal(
    [
      ...TAA_SHADER.matchAll(
        /textureStore\(validityOut,hp,vec4f\(f32\(validity\),0\.0,0\.0,0\.0\)\);$/gm,
      ),
    ].length,
    1,
  )
  // The history's validity is read from red, and its light always follows the pre-exposure.
  assert.match(TAA_SHADER, /let held=min\(past\.tag\.r,/)
  assert.match(TAA_SHADER, /color=vec4f\(color\.rgb\*light,color\.a\);/)
})

test("the velocity stage writes each texel's own vector alone; the analysis dilates by its closest surface", () => {
  const surface = SURFACE_VELOCITY_WGSL
  assert.match(
    surface,
    /vectorOut,p,vec4u\(encodeOwnVector\(motion\.xy,moves\),/,
    'the surface at the texel, flagged where it moves by itself',
  )
  // No neighbour is read by the stage, none of the analysis's outputs written; the page record is read
  // once, for the flags of the pixel, the second word.
  for (const gone of [
    'nearestSurface',
    'packDepthOffset',
    'occluders',
    'closestOut',
    'marksOut',
    'scatterOccluder',
  ])
    assert.equal(occurrences(surface, gone), 0, gone)
  assert.equal(occurrences(surface, 'pageOf(id)'), 1, 'the record is read once')
  assert.match(
    surface,
    /vec4u\(encodeOwnVector\(motion\.xy,moves\),withDepthStep\(flags,motion\.z\),0u,0u\)/,
  )
  // The motion of a surface is the stage's alone: the analysis finds the closest surface by its
  // 3×3 and reads the vector the stage wrote, and leaves the dilation to the reprojection.
  assert.equal(occurrences(surface, 'fn surfaceMotion('), 1)
  assert.equal(occurrences(surface, 'fn drawsMotion('), 1)
  assert.equal(occurrences(VELOCITY_SHADER, 'fn nearestSurface('), 1)
  assert.match(VELOCITY_SHADER, /let nearest=surface\.motion;/)
  assert.doesNotMatch(VELOCITY_SHADER, /vectorOut/)
  // The inputs sit at the same bindings, the vector after them.
  for (const name of ['view', 'depth'] as const)
    assert.equal(SURFACE_VELOCITY_BINDINGS[name], VELOCITY_BINDINGS[name], name)
  // The layout names each of them once: the normal atlas a displaced texel's prism is solved with too.
  assert.deepEqual(
    velocityInputEntries().map(({ binding }) => binding),
    Object.values(VELOCITY_INPUT_BINDINGS).sort((a, b) => a - b),
  )
  assert.match(surface, /@binding\(10\) var vectorOut:texture_storage_2d<rg32uint,write>/)
})

test('the bilinear read of smaller translucency is compiled only by the reduced programs', async () => {
  const { rejectShadingShader } = await import('./rejectionWgsl.ts')
  const { thinRelaxationShader } = await import('./thinGeometryWgsl.ts')
  const plain = [
    rejectShadingShader('rgba8unorm', 'rgba16float'),
    thinRelaxationShader('rgba8unorm'),
  ]
  const reduced = [
    rejectShadingShader('rgba8unorm', 'rgba16float', false, 'buffer', 'buffer', undefined, true),
    thinRelaxationShader('rgba8unorm', true),
  ]
  for (const text of plain) {
    assert.doesNotMatch(text, /reducedLayersAt/)
    assert.match(text, /loadHeld\(translucency,/)
  }
  for (const text of reduced) {
    assert.match(text, /reducedLayersAt\(translucency,\w,view\.render\.xy,view\.resurrection\.zw\)/)
    assert.doesNotMatch(text, /loadHeld\(translucency,/)
  }
})
