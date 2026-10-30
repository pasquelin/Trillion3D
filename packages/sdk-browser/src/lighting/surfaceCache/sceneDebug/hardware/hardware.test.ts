// The scene view's triangle trace: its sizes, its parameters' words and the WGSL text of its kernels, which assembles into modules that name nothing they do not declare.
import test from 'node:test'
import assert from 'node:assert/strict'
import { WORD_LIGHT_FORMAT } from '../../../../gpu/core/lightAtlasFormat.ts'
import { assertProgramAssembles } from '../../../../gpu/core/wgslNames.fixture.ts'
import { VISUALIZE_MODE } from '../../visualizeModes.ts'
import { hardwareAnswerWgsl } from './answerWgsl.ts'
import { dedicatedRaysWgsl } from './dedicatedRays.ts'
import {
  HARDWARE_DISPATCH_X,
  HARDWARE_FLAG,
  HARDWARE_PARAMS,
  hardwareDispatchOf,
  hardwareParamsOf,
  hardwareRayCapacity,
  hardwareRayWords,
  hardwareTileWords,
  hardwareTiles,
} from './layout.ts'
import { rayListWgsl } from './rayListWgsl.ts'
import { hardwareTraceWgsl } from './traceWgsl.ts'

test('a draw lists one group for each tile of 8 by 8 and a ray for each pixel of them', () => {
  assert.deepEqual(hardwareTiles([17, 9]), [3, 2])
  assert.equal(hardwareRayCapacity([17, 9]), 6 * 64)
  assert.equal(hardwareTileWords([17, 9]), 7)
  assert.equal(hardwareRayWords([17, 9]), 4 + 6 * 64)
  assert.deepEqual(hardwareDispatchOf([17, 9]), [HARDWARE_DISPATCH_X, 1])
  assert.deepEqual(hardwareDispatchOf([3840, 2160]), [HARDWARE_DISPATCH_X, 1013])
})

test('the parameters are written where the shader reads them', () => {
  const words = new Uint32Array(HARDWARE_PARAMS.words)
  hardwareParamsOf(words, {
    draw: [100, 50],
    display: [200, 100],
    rect: { x: 4, y: 6, width: 100, height: 50 },
    trace: [0.5, 1000, 10, 20],
    flags: HARDWARE_FLAG.hiRes | HARDWARE_FLAG.tiled,
    tonemap: true,
    culling: 2,
    fogSky: 3,
  })
  const floats = new Float32Array(words.buffer)
  const P = HARDWARE_PARAMS.at
  assert.deepEqual(Array.from(words.subarray(P.size, P.size + 4)), [100, 50, 200, 100])
  assert.deepEqual(Array.from(floats.subarray(P.trace, P.trace + 4)), [0.5, 1000, 10, 20])
  assert.deepEqual(Array.from(words.subarray(P.flags, P.flags + 3)), [17, 1, 2])
  assert.deepEqual(Array.from(floats.subarray(P.tile, P.tile + 4)), [4, 6, 100, 50])
  assert.equal(floats[P.fog], 3)
})

test('the kernels assemble', () => {
  assertProgramAssembles(rayListWgsl)
  assertProgramAssembles(hardwareTraceWgsl())
  for (const mode of [VISUALIZE_MODE.scene, VISUALIZE_MODE.surfaceCache, VISUALIZE_MODE.albedo])
    assertProgramAssembles(hardwareAnswerWgsl(WORD_LIGHT_FORMAT, mode))
  assertProgramAssembles(dedicatedRaysWgsl)
})
