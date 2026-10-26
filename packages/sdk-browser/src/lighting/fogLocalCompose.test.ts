// The fog laid over a point with the local volumes (`./fogCompose.ts`), the shipped shader text run as shipped
// (`shaderRun`): the volumes over the height fog, a translucent surface fogged by them only where the run says
// so, the sky's pixels, and a scene with a volume and no fog (`fogLocalRun.fixture.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { near } from '../../../math/src/float/near.fixture.ts'
import { fogRun } from './fogShaderRun.fixture.ts'
import { wgslModule } from '../../../math/src/wgsl/assemble.ts'
import { blendShader } from '../blend/shader.ts'
import { transmitWgsl } from '../blend/transmission/transmitWgsl.ts'
import { heightFogWgsl } from './fog/fogPassWgsl.ts'
import { airShapeOf } from './atmosphere/shape.ts'
import { composeProgram } from '../modules/sky/clouds/composeWgsl.ts'
import { cloudTraceProgram } from '../modules/sky/clouds/traceWgsl.ts'
import { FOG_PROGRAMS, fogProgramsWithoutLocal } from './fog/programs.ts'
import { resolveSettings } from '../../../sdk-core/src/contracts/settingRules.ts'
import { SKY_QUALITY_RULES } from '../../../sdk-core/src/modules/sky/quality.ts'
import { EYE, localSlots, overOf, placed, planSettings, volumeStub } from './fogLocalRun.fixture.ts'
import type { Vec3 as V3 } from '../../../math/src/vector/vectorTuple.ts'

const toward = (to: V3): V3 => [to[0] - EYE[0], to[1] - EYE[1], to[2] - EYE[2]]
/** `near` over `behind`. */
const stack = (near: number[], behind: number[]) => [
  near[0] + behind[0] * near[3],
  near[1] + behind[1] * near[3],
  near[2] + behind[2] * near[3],
  near[3] * behind[3],
]

type Fog = {
  fogOver: (P: V3, eye: V3, pixel: number[]) => number[]
  fogOverNoHaze: (P: V3, eye: V3, pixel: number[]) => number[]
  fogged: (rgb: V3, P: V3, eye: V3, pixel: number[]) => number[]
  fogOpaque: (P: V3, eye: V3, pixel: number[]) => number[]
  heightFog: (P: V3, eye: V3, sky: boolean) => number[]
  heightFogAlong: (toward: V3, height: number, sky: boolean) => number[]
  fogBeyond: (dir: V3, eye: V3) => number[]
  fogBeyondAt: (dir: V3, eye: V3, pixel: number[]) => number[]
  fogsBackground: () => boolean
}
const NAMES = [
  'fogOver',
  'fogOverNoHaze',
  'fogged',
  'fogOpaque',
  'heightFog',
  'heightFogAlong',
  'fogBeyond',
  'fogBeyondAt',
  'fogsBackground',
]
/** The fog's functions on `localFog`, over a fog's volume that lets `lookup` (its light and transmittance) pass
 *  where one is given. */
const run = (fog: object | undefined, localFog: number[][], lookup?: number[]) =>
  fogRun<Fog>(fog as never, NAMES, {
    localFog,
    ...(lookup && { resources: volumeStub(0, lookup) }),
  })

const FOG = { baseDensity: 0.01, falloff: 0.02, baseHeight: 0, color: [0.4, 0.5, 0.6] }
const SUN = { light: [2, 2, 2], toward: [0, 1, 0] }
const VOLUME = placed('v', [0, 2, -10], { emissive: [0.5, 0.5, 0.5] })
const P: V3 = [0, 2.4, -30]
/** The pixel the point is seen in. */
const PIXEL = [80, 45]

test('the local volumes lie over the height fog: a surface, a translucent fragment and the clouds are fogged by them, a translucent vertex where the run says so', () => {
  const off = localSlots([VOLUME], { sun: SUN }).slots
  const on = localSlots([VOLUME], {
    sun: SUN,
    settings: planSettings({ onTranslucent: true }),
  }).slots
  const height = run(FOG, off).heightFog(P, EYE, false)
  const stacked = stack(overOf(off)(toward(P)), height)
  assert.ok(stacked[3] < height[3] * 0.5, 'the volume is there')
  near(run(FOG, off).fogOverNoHaze(P, EYE, PIXEL), stacked, 'the clouds’ layer', 1e-9)
  // The translucent fragment lays them whatever the run says; its vertex works them out only where it does
  // (`LOCAL_FOG_FLAG.onTranslucent`).
  near(run(FOG, off).fogOver(P, EYE, PIXEL), stacked, 'translucent, off', 1e-9)
  near(run(FOG, on).fogOver(P, EYE, PIXEL), stacked, 'translucent, on', 1e-9)
  assert.match(
    blendShader({}),
    /fn fogLocalVertex[^{]*\{\s*if\(!fogDrawn\(\)\|\|!localFogFlagged\(\d+u\)\)\{return vec4f\(0\.0,0\.0,0\.0,1\.0\);\}/,
  )
  // The lit colour through it: behind the fog it multiplies by what the fog lets pass and adds what it scatters.
  const rgb: V3 = [0.8, 0.4, 0.2]
  const lit = (at: number[]) => rgb.map((c, i) => c * at[3] + at[i])
  near(run(FOG, off).fogged(rgb, P, EYE, PIXEL), lit(stacked), 'fogged, off', 1e-9)
  near(run(FOG, on).fogged(rgb, P, EYE, PIXEL), lit(stacked), 'fogged, on', 1e-9)
  near(run(FOG, off).fogOpaque(P, EYE, PIXEL), stacked, 'fog over an opaque surface', 1e-9)
})

test('the sky’s pixel is fogged by the volumes too, the sky light’s capture is not; a scene with no fog and a volume still draws it', () => {
  const slots = localSlots([VOLUME], { sun: SUN }).slots
  const dir: V3 = [0, 0.02, -1]
  const length = Math.hypot(...dir)
  const unit = dir.map((c) => c / length) as V3
  const far = unit.map((c) => c * 1e11) as V3
  const beyond = run(FOG, slots)
  const height = beyond.heightFogAlong(far, EYE[1], false)
  assert.ok(
    Math.abs(beyond.fogBeyond(unit, EYE)[3] - height[3]) < 1e-9,
    'the capture: the fog alone',
  )
  const volume = overOf(slots)(far)
  assert.ok(volume[3] < 0.5)
  near(beyond.fogBeyondAt(unit, EYE, [0, 0]), stack(volume, height), 'the sky’s pixel', 1e-6)
  // No fog: the volume alone, over a pixel the lighting paints (no atmosphere draws a sky there).
  const bare = run(undefined, slots)
  assert.equal(bare.fogsBackground(), true)
  near(bare.fogBeyondAt(unit, EYE, [0, 0]), volume, 'no fog', 1e-9)
  const local = overOf(slots)(toward(P))
  near(
    bare.fogged([1, 1, 1], P, EYE, PIXEL),
    [0, 1, 2].map((i) => local[3] + local[i]),
    'a translucent surface, no fog: the volumes alone',
    1e-9,
  )
  near(bare.fogOpaque(P, EYE, PIXEL), overOf(slots)(toward(P)), 'an opaque surface', 1e-9)
  // Neither a volume nor a fog: nothing to paint.
  assert.equal(run(undefined, localSlots([]).slots).fogsBackground(), false)
  assert.equal(run(FOG, localSlots([]).slots).fogsBackground(), true)
})

test('the volumes lie under the fog’s volume, whether voxelised into it or kept out of it, on a surface and on the sky', () => {
  const [inside, outside] = [true, false].map(
    (inVolume) => localSlots([VOLUME], { sun: SUN, settings: planSettings({ inVolume }) }).slots,
  )
  const lookup = [0.1, 0.2, 0.3, 0.6]
  const [within, over] = [run(FOG, inside, lookup), run(FOG, outside, lookup)]
  // The same volumes, whole (the volume covers none of the near air), either way: only their place differs.
  const local = overOf(inside)(toward(P), PIXEL)
  near(overOf(outside)(toward(P), PIXEL), local, 'the same volume', 1e-9)
  const height = within.heightFog(P, EYE, false)
  const under = stack(lookup, stack(local, height))
  assert.ok(
    Math.abs(under[0] - stack(stack(local, lookup), height)[0]) > 1e-3,
    'the two orders differ',
  )
  near(within.fogOverNoHaze(P, EYE, PIXEL), under, 'voxelised: the volume nearest', 1e-9)
  near(over.fogOverNoHaze(P, EYE, PIXEL), under, 'kept out: the volume nearest too', 1e-9)
  // The sky’s pixel, along the far ray.
  const dir: V3 = [0, 0.02, -1]
  const unit = dir.map((c) => c / Math.hypot(...dir)) as V3
  const far = unit.map((c) => c * 1e11) as V3
  const sky = overOf(inside)(far)
  const farHeight = within.heightFogAlong(far, EYE[1], false)
  near(
    within.fogBeyondAt(unit, EYE, [0, 0]),
    stack(lookup, stack(sky, farHeight)),
    'the sky, voxelised',
    1e-6,
  )
  near(
    over.fogBeyondAt(unit, EYE, [0, 0]),
    stack(lookup, stack(sky, farHeight)),
    'the sky, kept out',
    1e-6,
  )
})

const TRACE = {
  depth: 'scene',
  minMaxDepth: false,
  emptySpace: false,
  opaqueShadow: false,
  localLights: false,
  skyLight: false,
  volumeShadowMap: false,
  closestDepth: false,
} as const

test('the project switch off: no program that lays the fog holds any of the local fog volumes’ code, and each holds it with the switch on', () => {
  const quality = resolveSettings(SKY_QUALITY_RULES, {})
  const [on, off] = [airShapeOf(quality, true), airShapeOf(quality, false)]
  const key = { lobeless: true }
  const texts = (local: boolean, shape = local ? on : off) => ({
    'the fog pass': wgslModule(heightFogWgsl(local)),
    'the blend': blendShader(key, { localFog: local }),
    'the transmissive stages': blendShader(key, {
      stage: transmitWgsl(key, false),
      localFog: local,
    }),
    'the clouds’ composition': composeProgram(
      { upsampling: 0, minMaxDepth: false, direct: false },
      local,
    ),
    'the clouds’ trace': cloudTraceProgram(TRACE, shape),
    'the fog volume’s scatter': (local ? FOG_PROGRAMS : fogProgramsWithoutLocal()).scatter,
  })
  const code = /localFog(?!:array)|LocalFog|localCull|directLights\.localFog\b/
  // The block in the light buffer is data of its layout, in the structure every program declares.
  const held = (text: string) => code.test(text.replace(/localFog:array<vec4f,\d+>,/g, ''))
  const [without, with_] = [texts(false), texts(true)]
  for (const [name, text] of Object.entries(without)) {
    assert.ok(text, `${name} is a program`)
    assert.ok(!held(text), `${name} holds none of their code`)
  }
  for (const [name, text] of Object.entries(with_)) {
    assert.ok(text, `${name} is a program`)
    assert.ok(held(text), `${name} holds it`)
  }
})
