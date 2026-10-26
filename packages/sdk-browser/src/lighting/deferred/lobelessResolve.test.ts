// An image none of whose surfaces carries an anisotropic or clear-coat lobe is resolved by a program
// with no lobe code (`../direct/lobesWgsl.ts`), and an image that holds one never is. On a pixel
// without lobes the program with lobe code sums the same, bit for bit: run on the GPU,
// `tests/gpu/lighting/lobes-resolve.gpu.ts`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { lobelessLighting } from './recorder.fixture.ts'
import { LOBELESS_MODELS_LIGHTING_WGSL } from '../direct/lobesWgsl.ts'
import { contractLightingShader } from '../../gpu/core/shaderTexts.fixture.ts'
import { REFLECTION_BILATERAL_WGSL } from '../reflections/bilateralWgsl.ts'
import { wgslSource } from '../../../../math/src/wgsl/source.fixture.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { ENVIRONMENT_LIGHTING_WGSL } from '../direct/lightingWgsl.ts'
import { litPassShaders } from '../../gpu/core/shaderTexts.fixture.ts'
import { near } from '../../../../math/src/float/near.fixture.ts'
import { AS_IS_FLAG, MODEL_FLAG, UNLIT_FLAG } from '../../materials/surface/surfaceModelWord.ts'
import { FOG_FREE_SURFACE_FLAG } from '../../materials/surface/surfaceModel.ts'
import { SUBSURFACE_FLAG } from '../../materials/surface/subsurface.ts'
import { PHYSICAL_SURFACE_FLAG } from '../../materials/surface/physicalLobes.ts'
import { PIXEL_TILE_CLASS_WGSL } from './tileClass.ts'

test('only the program with lobes reads them and lights through them', () => {
  for (const bounce of [false, true]) {
    const plain = contractLightingShader(bounce, { lobeless: true })
    const lobes = contractLightingShader(bounce, {})
    for (const call of ['anisotropicLobe(', 'fn coatedLight(', 'textureLoad(physicalLobes'])
      assert.ok(!plain.includes(call) && lobes.includes(call), call)
    // The lobeless program calls the same names, its stand-in weighing by one: its own text, the
    // surface light it calls being both programs'; it reads no lobe at all (`readLobes`).
    assert.ok(
      plain.includes(LOBELESS_MODELS_LIGHTING_WGSL.text) &&
        !lobes.includes(LOBELESS_MODELS_LIGHTING_WGSL.text),
    )
    assert.ok(!plain.includes('readLobes(coord,') && lobes.includes('readLobes(coord,'))
    assert.ok(plain.includes('coatLayerKeep()') && lobes.includes('coatLayerKeep()'))
  }
})

test('an image with no lobed surface is lit by the lobeless program and compiles no lobe code', async () => {
  const { lighting, labels, draw } = await lobelessLighting()
  // No lobe code compiled beside it: a lobed surface that arrives asks for its program then, and
  // is never lit by the lobeless one.
  assert.equal(draw({ lobeless: false }), false, 'the lobed program is compiling')
  await lighting.settle()
  draw({ lobeless: false })
  draw({ lobeless: true })
  assert.deepEqual(labels(), ['DIRECT_LOBELESS', 'DIRECT', 'DIRECT_LOBELESS'])
  lighting.dispose()
})

test("every contract program lights a pixel by its own specular, read from its flags, and a coat is the clear coat model's", () => {
  for (const bounce of [false, true]) {
    const text = contractLightingShader(bounce, {})
    // The pixel's specular set once, before it is lit: its lights and, in the bounce program, its reflection's weight.
    assert.match(text, /surfaceModel=flag;\s*surfaceSpecular=specularOfFlags\(surfaceFlag\);/)
    assert.match(
      text,
      /fn lobeSurface\(rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f\)->LobeSurface\{\s*return lobeSurfaceOf\(surfaceF0\(rgb,metal\),/,
    )
    assert.match(text, /fn coatedLight\(/)
    assert.doesNotMatch(text, /f0Of\(/)
  }
  assert.match(
    contractLightingShader(true, {}),
    /reflectionWeight\(indirectF0\(rgb,metal\),rough,N,V\)/,
  )
  // The reflection's last pass weighs the surface's trace by its own reflectance too.
  const bilateral = wgslSource(REFLECTION_BILATERAL_WGSL)
  assert.match(bilateral, /surfaceSpecular=specularOfFlags\(flags\);\s*let own=reflectingPixelAt/)
  assert.match(bilateral, /reflectionBaseShare\(seen,indirectF0\(base\.rgb,base\.a\),/)
})

test('a pixel is classed by the code its surface needs: none for the background, unlit and as-is pixels, then simple, single, complex', () => {
  const { pixelTileClass } = shaderRun<{ pixelTileClass: (flags: number) => number }>(
    PIXEL_TILE_CLASS_WGSL,
    ['pixelTileClass'],
    {},
  )
  const classes: [string, number, number][] = [
    ['the background', 0, 0],
    ['an unlit surface', UNLIT_FLAG, 0],
    ['a surface shown as it is', AS_IS_FLAG, 0],
    ['a plain physical surface', MODEL_FLAG.physical, 1],
    ['one that opts out of the fog', MODEL_FLAG.physical | FOG_FREE_SURFACE_FLAG, 1],
    ['a diffuse surface', MODEL_FLAG.diffuse, 2],
    ['a toon surface', MODEL_FLAG.toon, 2],
    ['a shadow catcher', MODEL_FLAG.shadow, 2],
    ['a thin two-sided surface', MODEL_FLAG.physical | SUBSURFACE_FLAG, 2],
    ['a surface with a lobe', MODEL_FLAG.physical | PHYSICAL_SURFACE_FLAG, 3],
    [
      'a thin surface with a lobe',
      MODEL_FLAG.physical | SUBSURFACE_FLAG | PHYSICAL_SURFACE_FLAG,
      3,
    ],
  ]
  for (const [what, flags, expected] of classes) assert.equal(pixelTileClass(flags), expected, what)
})

test('a thin surface’s back takes the screen probes’ light where they left one, the world’s probes’ else', () => {
  const text = wgslProgram(
    `fn probeBack(screen:vec4f,N:vec3f)->vec3f{
 thinSubsurface=vec3f(0.5);
 thinScreenBack=screen;
 return thinBack(N,vec3f(0.0),1.0);
}`,
    [ENVIRONMENT_LIGHTING_WGSL],
  )
  const { probeBack } = shaderRun<{ probeBack: (screen: number[], N: number[]) => number[] }>(
    text,
    ['probeBack'],
    {
      directLights: { environment: Array.from({ length: 9 }, () => [0, 0, 0, 0]) },
      indirectIrradiance: () => [3, 3, 3],
      environmentSky: () => [0, 0, 0],
    },
  )
  const up = [0, 1, 0]
  near(
    probeBack([0, 0, 0, 0], up),
    [1.5 / Math.PI, 1.5 / Math.PI, 1.5 / Math.PI],
    'the world’s',
    1e-6,
  )
  near(probeBack([1, 2, 4, 1], up), [0.5 / Math.PI, 1 / Math.PI, 2 / Math.PI], 'the screen’s', 1e-6)
  // A back the probes found black stays black: no fall back to the world's light, which the sky would leak through.
  near(probeBack([0, 0, 0, 1], up), [0, 0, 0], 'a black back', 1e-6)
  // A level that gathers no back light folds the subsurface colour, over pi, into the front diffuse: the probes' front
  // irradiance (here [1, 2, 4]) lights it, not the world's.
  near(
    probeBack([1, 2, 4, 2], up),
    [0.5 / Math.PI ** 2, 1 / Math.PI ** 2, 2 / Math.PI ** 2],
    'the front diffuse’s',
    1e-6,
  )
  // Only the program that bounces reads them, and only for the classes that hold thin surfaces.
  const read = (bounce: boolean, lobeless: boolean) =>
    litPassShaders(bounce, { lobeless }).indirect.split('screenBackAt(coord)').length - 1
  assert.equal(read(true, true), 1, 'read once a pixel')
  assert.equal(read(false, true), 0, 'a program with no bounce reads no screen probe')
})
