// The clouds' sky occlusion in the air's programs: the read of its map, the multiple scattering of the
// first light it dims in the shipped march, and the programs that read it — the sky, the haze, the
// sky light's capture —, not the tables the air's coefficients alone make.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { Mat } from '../../materials/texture/shaderRunMatrix.fixture.ts'
import { airBlock, airLight, blockRows } from '../../materials/texture/airBlock.fixture.ts'
import { airProgram, type AirBindings } from './programs.ts'
import { capture360Program } from './capture360Wgsl.ts'
import { hazeProgram } from './hazeWgsl.ts'
import { opaqueHazeProgram } from './opaqueHazeWgsl.ts'
import { airProgramsOf } from './airPrograms.fixture.ts'
import { DEFAULT_AIR_SHAPE } from './shape.ts'
import { skyProgram } from './skyWgsl.ts'
import {
  cloudShadowReadWgsl,
  CLOUD_SHADOW_BLOCK,
  writeCloudShadowBlock,
} from './cloudShadowRead.ts'
import { AIR_CLOUD_SHADOW } from './binding.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { cloudHazeProgram } from '../../modules/sky/clouds/traceHazeProgram.ts'
import { skyFaceProgram } from '../../modules/sky/skyLight/faceWgsl.ts'

/** A map's texel the lookups below read: the front depth, the mean extinction, the greatest optical depth. */
const TEXEL = [0, 1, Math.LN2, 1]
/** The sky occlusion's matrix: the clip position of a point is its x and y, its depth 0, so the
 *  point is `far` kilometres behind the near plane whatever it is. */
const FLAT = new Mat([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1])

/** The scope the read of the clouds' shade is run with: a block whose sky occlusion is `far`
 *  kilometres deep (0: none) and whose light maps shade nothing, `texel` read from the sky map. */
const scopeOf = (far: number, texel = TEXEL) => ({
  cloudShadowBlock: {
    clip0: FLAT,
    clip1: FLAT,
    clipSky: FLAT,
    camera: [0, 0, 0, 0],
    far: [1, 1, far, 0],
    strength: [0, 0, 0, 0],
  },
  cloudShadowMap0: {},
  cloudShadowMap1: {},
  cloudSkyMap: {},
  tableSampler: {},
  textureSampleLevel: () => texel,
})

const AIR: AirBindings = {
  air: 'read',
  transmittance: true,
  multiScatter: true,
  cloudShadow: true,
}

test('the sky occlusion is the share exp(-optical depth) of its map, 1 where the block holds none', () => {
  const read = (far: number, texel: number[]) =>
    shaderRun<{ cloudSkyOcclusionAt: (p: number[]) => number }>(
      wgslModule(cloudShadowReadWgsl(AIR_CLOUD_SHADOW)),
      ['cloudSkyOcclusionAt'],
      scopeOf(far, texel),
    ).cloudSkyOcclusionAt([0, 0, 0])
  assert.equal(read(0, TEXEL), 1, 'no map: all the light')
  // The greatest optical depth bounds the path's: here the path (2 km behind the front, at 1/m)
  // is longer than the greatest, ln 2.
  assert.ok(Math.abs(read(100, TEXEL) - 0.5) < 1e-6)
  // A short path: 0.001 per metre over the 3 km from the front depth 2 to the sample at 5.
  assert.ok(Math.abs(read(5, [2, 0.001, 10, 1]) - Math.exp(-3)) < 1e-6)
})

/** The radiance a ray of the air marches up from the ground under `lights`, the multiple scattering
 *  table answering `multi` (the same in every channel), the sky occlusion `far` kilometres deep. */
function marched(lights: ReturnType<typeof airLight>[], multi: number, far: number) {
  const program = airProgram(
    AIR,
    `fn airToScene(p:vec3f)->vec3f{return p;}
fn marchedUp()->vec3f{
 var march=newMarch();
 march.samples=6.0;
 return integrateAir(vec3f(0.0,bottomRadius()+0.001,0.0),vec3f(0.0,1.0,0.0),false,march,false,airSuns(),1.0,20.0).radiance;
}`,
  )
  const { marchedUp } = shaderRun<{ marchedUp: () => number[] }>(program.code, ['marchedUp'], {
    directLights: { atmosphere: blockRows(airBlock(...lights)) },
    transmittanceAt: () => [1, 1, 1],
    multiScatterAt: () => [multi, multi, multi],
    ...scopeOf(far),
  })
  return marchedUp()
}

test('the multiple scattering of the first light is dimmed by the sky occlusion, the second light’s is not', () => {
  const first = airLight([0, 1, 0], 1),
    second = airLight([0.6, 0.8, 0], 3)
  const dimmed = (lights: (typeof first)[]) => {
    const none = marched(lights, 0, 100)
    const multi = marched(lights, 1, 0)
    const occluded = marched(lights, 1, 100)
    return multi.map((m, c) => ({ added: m - none[c], kept: occluded[c] - none[c] }))
  }
  const alone = dimmed([first]),
    other = dimmed([second]),
    both = dimmed([first, second])
  for (let c = 0; c < 3; c++) {
    assert.ok(alone[c].added > 0, 'the multiple scattering adds light')
    assert.ok(Math.abs(alone[c].kept - 0.5 * alone[c].added) < 1e-6 * alone[c].added)
    // Two lights: the first is halved, the second whole.
    const expected = 0.5 * alone[c].added + other[c].added
    assert.ok(Math.abs(both[c].kept - expected) < 1e-5 * both[c].added)
  }
})

test('the programs that march the air with the lights read the sky occlusion; the tables do not', () => {
  const reads = (code: string) => /fn cloudSkyOcclusionAt/.test(code)
  const marching = {
    'the haze': hazeProgram(DEFAULT_AIR_SHAPE, false),
    'the haze kept apart': hazeProgram(DEFAULT_AIR_SHAPE, true),
    'the haze around the capture': capture360Program(DEFAULT_AIR_SHAPE),
    'the marched sky': skyProgram({
      ...DEFAULT_AIR_SHAPE,
      skyView: { ...DEFAULT_AIR_SHAPE.skyView, fast: false },
    }),
    'the haze on the opaque surfaces': opaqueHazeProgram(DEFAULT_AIR_SHAPE),
    'the haze on a cloud': cloudHazeProgram(DEFAULT_AIR_SHAPE),
    'the sky of the sky light’s capture': skyFaceProgram(DEFAULT_AIR_SHAPE),
    'the same, shaded by the opaque scene': skyFaceProgram(DEFAULT_AIR_SHAPE, true),
  }
  for (const [what, program] of Object.entries(marching))
    assert.ok(reads(program.code), `${what} reads the sky occlusion`)
  const { skyView, multiScatter, distantSky } = airProgramsOf(DEFAULT_AIR_SHAPE)
  assert.ok(reads(skyView.code), 'the sky table around the eye')
  for (const [what, program] of Object.entries({ multiScatter, distantSky }))
    assert.ok(
      !reads(program.code) &&
        /fn airSkyOcclusion\(p:vec3f\)->f32\{return 1\.0;\}/.test(program.code),
      `${what} reads none`,
    )
})

test('the block holds the sky occlusion map’s matrix and far depth, an identity and a far depth of 0 without it', () => {
  const { at } = CLOUD_SHADOW_BLOCK
  const words = new Float32Array(CLOUD_SHADOW_BLOCK.words)
  const clip = Array.from({ length: 16 }, (_, i) => i + 1)
  writeCloudShadowBlock(words, [undefined, undefined], [1, 2, 3], {
    clipFromCamera: clip,
    cameraFromClip: clip,
    rayDirection: [0, 0, -1],
    side: 64,
    farDepthKm: 7,
  })
  assert.deepEqual(Array.from(words.subarray(at.clipSky, at.clipSky + 16)), clip)
  assert.equal(words[at.far + 2], 7)
  assert.deepEqual(
    Array.from(words.subarray(at.far, at.far + 2)),
    [1, 1],
    'the lights’ own far depths',
  )
  writeCloudShadowBlock(words, [undefined, undefined], [1, 2, 3])
  assert.deepEqual(
    Array.from(words.subarray(at.clipSky, at.clipSky + 16)),
    [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  )
  assert.equal(words[at.far + 2], 0)
})
