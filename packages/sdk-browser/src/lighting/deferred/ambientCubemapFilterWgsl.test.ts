// The ambient cubemap's angular filter (`ambientCubemapFilterWgsl.ts`): the shipped WGSL text, run in JavaScript, against the processor's
// reference (`ambientCubemapMipRows`) texel by texel; the shape of its record and of its faces' uniform; the kernels' declarations.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { lcgRandom } from '../../../../math/src/sequence/random.ts'
import { mipSize } from '../../../../math/src/scalar/integers.ts'
import {
  AMBIENT_CUBEMAP_FACE_PERM,
  AMBIENT_CUBEMAP_FACE_SIGN,
  ambientCubemapLevelCone,
} from '../../../../sdk-core/src/lighting/ambientCubemapMips.ts'
import {
  ambientCubemapMipRows,
  prepareAmbientCubemap,
} from '../../../../sdk-core/src/lighting/ambientCubemapMips.fixture.ts'
import {
  CUBE_AVERAGE_ENTRY,
  CUBE_FACES_WORDS,
  CUBE_FILTER_ENTRY,
  cubeAverageShader,
  cubeFilterShader,
} from './ambientCubemapFilterWgsl.ts'
import { CUBE_FILTER } from './ambientCubemapFilterText.ts'
import { CUBE_FILTER_WGSL } from './ambientCubemapFilterText.ts'
import { assertProgramAssembles } from '../../gpu/core/wgslNames.fixture.ts'

const SIZE = 16
const random = lcgRandom(7121)
const texels = new Float32Array(6 * SIZE * SIZE * 3).map(() => random() * 4)
const prepared = prepareAmbientCubemap({ size: SIZE, texels })

/** The record the kernel reads, as the host writes it (`ambientCubemapBuild.ts`), and the faces' uniform. */
const record = {
  counts: [0, 0, 0, 0],
  cone: [0, 0, 0, 0],
  span: [0, 0, 0, 0],
  scale: 1,
}
const faces = {
  perm: AMBIENT_CUBEMAP_FACE_PERM.map((perm) => [...perm, 0]),
  signs: AMBIENT_CUBEMAP_FACE_SIGN.map((sign) => [...sign, 0]),
}
const kernel = shaderRun<{
  cubeDirection: (face: number, u: number, v: number) => number[]
  cubeConeMean: (direction: number[]) => number[]
}>(wgslModule(CUBE_FILTER_WGSL), ['cubeDirection', 'cubeConeMean'], {
  cubeFaces: faces,
  cubeFilter: record,
  cubeSource: {},
  cubeFiltered: {},
  textureLoad: (_texture: unknown, at: number[], face: number, level: number) => {
    const side = mipSize(SIZE, level)
    const from = ((face * side + at[1]) * side + at[0]) * 3
    return [...prepared.averaged[level].subarray(from, from + 3), 1]
  },
})

/** Points the record at `rows` rows of face `face` of mip `level`, from row `first`. */
function aim(level: number, face: number, first: number, rows: number) {
  const { source, sin, cos, kernelCos, inverseWidth } = ambientCubemapLevelCone(SIZE, level)
  record.counts = [mipSize(SIZE, level), mipSize(SIZE, source), face, first]
  record.cone = [sin, cos, kernelCos, inverseWidth]
  record.span = [source, rows, 0, 0]
}

test('the filter of a texel is the reference’s, whatever the mip and the face', () => {
  for (const level of [0, 1, 2, 3]) {
    const side = mipSize(SIZE, level)
    for (const face of [0, 2, 5]) {
      const expected = new Float32Array(side * side * 3)
      ambientCubemapMipRows(prepared, level, face, 0, side, expected)
      aim(level, face, 0, side)
      for (let y = 0; y < side; y++)
        for (let x = 0; x < side; x++) {
          const u = (x + 0.5) * (1 / side) * 2 - 1,
            v = (y + 0.5) * (1 / side) * 2 - 1
          const got = kernel.cubeConeMean(kernel.cubeDirection(face, u, v))
          for (let k = 0; k < 3; k++)
            assert.ok(
              Math.abs(got[k] - expected[(y * side + x) * 3 + k]) <=
                1e-5 * Math.max(1, Math.abs(expected[(y * side + x) * 3 + k])),
              `mip ${level} face ${face} (${x}, ${y}) channel ${k}: ${got[k]} against ${expected[(y * side + x) * 3 + k]}`,
            )
        }
    }
  }
})

test('the direction of a point of a face is a unit one, for the six faces', () => {
  for (let face = 0; face < 6; face++) {
    const [x, y, z] = kernel.cubeDirection(face, 0.3, -0.6)
    assert.ok(Math.abs(Math.hypot(x, y, z) - 1) < 1e-12)
  }
})

test('the record and the faces’ uniform have the sizes the host writes', () => {
  assert.equal(CUBE_FILTER.words, 16)
  assert.deepEqual(
    [CUBE_FILTER.at.counts, CUBE_FILTER.at.cone, CUBE_FILTER.at.span, CUBE_FILTER.at.scale],
    [0, 4, 8, 12],
  )
  assert.equal(CUBE_FACES_WORDS, 6 * 4 * 2)
})

test('the kernels’ programs declare every name they use and name their entries', () => {
  const filter = cubeFilterShader()
  assertProgramAssembles(filter, CUBE_FILTER_ENTRY, 'the angular filter')
  const average = cubeAverageShader()
  assertProgramAssembles(average, CUBE_AVERAGE_ENTRY, 'the box filter')
})
