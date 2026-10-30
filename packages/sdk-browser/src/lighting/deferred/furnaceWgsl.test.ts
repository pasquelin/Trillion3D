// The shading furnace test (`furnaceWgsl.ts`): its program is the sun pass's bindings with its own entries, for every class of tile; the pipeline
// override sets the samples; the clear coat's lobe is the coat's where the pixel has one and the base lobe's otherwise.
import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { FULL_CONTRACT } from './contractCuts.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { FURNACE_ENTRY, FURNACE_SAMPLES, FURNACE_SKY_ENTRY, FURNACE_WGSL } from './furnaceWgsl.ts'
import { sunPassWgsl } from './lightPassWgsl.ts'
import { TILE_CLASSES } from './tileClass.ts'
import { assertProgramAssembles } from '../../gpu/core/wgslNames.fixture.ts'

test('the furnace program holds its entries over the sun pass’s bindings, for every class of tile, and the sun pass holds none of them', () => {
  for (const tileClass of TILE_CLASSES) {
    const furnace = wgslModule(sunPassWgsl(FULL_CONTRACT, tileClass, true))
    assertProgramAssembles(furnace, FURNACE_ENTRY, `the furnace of class ${tileClass}`)
    assertProgramAssembles(
      furnace,
      FURNACE_SKY_ENTRY,
      `the furnace’s background of class ${tileClass}`,
    )
    assert.match(furnace, new RegExp(`override ${FURNACE_SAMPLES}:u32=64u;`))
    assert.match(furnace, /@vertex fn furnaceCorner/)
    assert.match(furnace, /@vertex fn tile\(/, 'the tiles’ vertex stage')
    assert.doesNotMatch(furnace, /fn sunMain/)
    const sun = wgslModule(sunPassWgsl(FULL_CONTRACT, tileClass))
    assert.doesNotMatch(sun, /furnace|FURNACE/i)
  }
})

test('the three sets are the specular lobe, the cosine hemisphere and the coat’s lobe, weighed by the power heuristic of the three densities', () => {
  const text = wgslModule(sunPassWgsl(FULL_CONTRACT, TILE_CLASSES[2], true))
  assert.match(
    text,
    /let widths=vec3f\(shading\.alpha2,1\.0,coatSampleAlpha2\(shading\.alpha2\)\);/,
  )
  assert.match(text, /fn coatSampleAlpha2\(base:f32\)->f32\{\s*if\(!hasCoat\(\)\)\{return base;\}/)
  assert.match(text, /let inverse=dot\(densities,densities\);/)
  assert.match(text, /select\(0\.0,1\.0\/inverse,inverse>1e-5\)\*densities\[lobeSet\]/)
  const lobeless = wgslModule(
    sunPassWgsl({ ...FULL_CONTRACT, lobeless: true }, TILE_CLASSES[1], true),
  )
  assert.match(lobeless, /fn coatSampleAlpha2\(base:f32\)->f32\{return base;\}/)
})

/** The furnace’s text run in JavaScript over a surface that is a Lambert diffuse of the albedo `albedo` and nothing else. */
function lambertFurnace(albedo: number, normal: number[], view: number[]) {
  const structs =
    'struct Lamp{toward:vec3f,centre:vec3f,falloff:f32,side:f32,cosine:f32,wrap:f32,lineCos:f32,capsule:bool,}\nstruct DirectLight{positionRange:vec4f,}\nstruct LobeSurface{alpha2:f32,}\n'
  const run = shaderRun<{ furnaceRadiance: (...args: unknown[]) => number[] }>(
    structs + wgslModule(FURNACE_WGSL),
    ['furnaceRadiance'],
    {
      lobeSurface: () => ({ alpha2: 0.3 }),
      clothSurface: (surface: unknown) => surface,
      lobeView: () => {},
      coatSampleAlpha2: (base: number) => base,
      reverseBits: (word: number) => {
        let reversed = 0
        for (let bit = 0; bit < 32; bit++) reversed = ((reversed << 1) | ((word >>> bit) & 1)) >>> 0
        return reversed
      },
      lampLight: (
        _s: unknown,
        _n: number[],
        _v: number[],
        _l: unknown,
        _p: number[],
        lamp: { cosine: number },
        energy: number,
      ) => [1, 1, 1].map(() => ((albedo * lamp.cosine) / Math.PI) * energy),
    },
  )
  return run.furnaceRadiance([1, 1, 1], 0, 0.5, normal, view, [0, 0, 0])
}

test('a Lambert diffuse surface returns its albedo times the furnace’s radiance, whatever the view: the weighed samples sum to the integral of the environment', () => {
  for (const view of [
    [0, 0, 1],
    [0, 0.6, 0.8],
    [0.96, 0, 0.28],
  ]) {
    const [red] = lambertFurnace(0.8, [0, 0, 1], view)
    assert.ok(Math.abs(red - 0.8 * 0.5) < 0.01, `view ${view}: ${red}`)
  }
})
