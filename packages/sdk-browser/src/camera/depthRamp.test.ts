// The depth material's ramp (#365): planes at the near plane, mid-way and the far plane read 1,
// 0.5 and 0, whatever the depth buffer holds. The resolve applies the weights to a pixel's clip
// coordinates (`../visibility/shader/shadeWgsl.ts`). The expression is read out of the shipped
// shader text and evaluated here, so a shader edit is what the test sees.
import { saturate } from '../../../math/src/scalar/reals.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { writeDepthRamp } from './depthConvention.ts'
import { SURFACE_MODEL } from '../scene/surfaceModel.ts'
import { SHADE_SHADER } from '../visibility/shader/shadeWgsl.ts'
import { SHADE_DECL_WGSL } from '../visibility/shader/shadeDeclWgsl.ts'
import { wgslModule } from '../../../math/src/wgsl/assemble.ts'
import { DEPTH_RAMP_WORD, SHADE_UNIFORM_WORDS } from '../visibility/shader/request.ts'
import {
  orthographicProjection,
  perspectiveProjection,
} from '../../../math/src/projection/camera.ts'

const NEAR = 0.1,
  FAR = 100,
  DISTANCES = [NEAR, (NEAR + FAR) / 2, FAR],
  EXPECTED = [1, 0.5, 0]

/** Clip `z` and `w` of the point `distance` ahead of the eye, on the view axis. */
function clipOf(projection: Float64Array, distance: number) {
  const z = -distance
  return { z: projection[10] * z + projection[14], w: projection[11] * z + projection[15] }
}

/** The ramp expression of a shader, the text between `clamp(` and `,0.0,1.0)` on its line. */
function rampExpression(source: string, line: RegExp) {
  const found = source.match(line)
  assert.ok(found, `no depth line matching ${line}`)
  return found[1]
}

const wgsl = rampExpression(
  SHADE_SHADER,
  new RegExp(
    `if\\(model==${SURFACE_MODEL.depth}u\\)\\{.*?rgb=vec3f\\(clamp\\((.*?),0\\.0,1\\.0\\)\\);\\}`,
  ),
)
/** The WebGPU resolve's line, `clamp(a·w + b + c·z/w)`, over the pixel's interpolated clip z, w. */
const resolveOf = new Function(
  'r',
  'w',
  'z',
  `return ${wgsl.replace('dot(bary,vec3f(c0.z,c1.z,c2.z))', 'z')};`,
) as (r: { x: number; y: number; z: number }, w: number, z: number) => number
function resolveRamp(weights: Float32Array, clip: { z: number; w: number }) {
  const [x, y, z] = weights
  return saturate(resolveOf({ x, y, z }, clip.w, clip.z))
}

const close = (actual: number[], label: string) =>
  actual.forEach((value, i) =>
    assert.ok(Math.abs(value - EXPECTED[i]) < 1e-5, `${label}: ${value}`),
  )

test('WebGPU, perspective: the reversed depth still shows white near, black far', () => {
  const projection = perspectiveProjection(new Float64Array(16), 50, 1, NEAR, 1)
  const weights = writeDepthRamp(new Float32Array(3), 0, NEAR, FAR, 1)
  close(
    DISTANCES.map((d) => resolveRamp(weights, clipOf(projection, d))),
    'perspective',
  )
})

test('WebGPU, orthographic: the same ramp from the affine depth', () => {
  const projection = orthographicProjection(new Float64Array(16), -1, 1, -1, 1, NEAR, FAR)
  const weights = writeDepthRamp(new Float32Array(3), 0, NEAR, FAR, 0)
  close(
    DISTANCES.map((d) => resolveRamp(weights, clipOf(projection, d))),
    'orthographic',
  )
})

test('The weights land at the offset they are given, nothing around them', () => {
  const words = new Float32Array(6).fill(7)
  writeDepthRamp(words, 2, NEAR, FAR, 1)
  assert.deepEqual([words[0], words[1], words[5]], [7, 7, 7])
  assert.equal(words[4], 0, 'no clip-z weight under a perspective projection')
})

test('The resolve uniform: the ramp is the last vec4f, 16-byte aligned', () => {
  assert.match(wgslModule(SHADE_DECL_WGSL), /feedback:u32,depthRamp:vec4f,\}/)
  // viewProj 16 words, viewport 2 and five scalars, one padding word: the ramp starts at word 24.
  assert.equal(DEPTH_RAMP_WORD, 16 + 4 + 4)
  assert.equal(DEPTH_RAMP_WORD % 4, 0)
  assert.equal(SHADE_UNIFORM_WORDS, DEPTH_RAMP_WORD + 4)
})
