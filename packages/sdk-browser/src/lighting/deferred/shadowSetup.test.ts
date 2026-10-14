// The surface reads its cell of the light grid once — the record the lighting walks and the
// shadow flag in its count's high bit — and sets up what a shadow read needs — the eye, its
// receiver offset (recomputed from the visibility buffer); its normal bias is the projection's,
// no neighbour depth read — only where the cell lists a shadowed light, the
// one place a shadow is read; the program with no shadow code never does. Nothing else reads them,
// so the sums are the same. The opaque shadow is the mask's: all but the mask's pixel is set only for
// the translucent casters' point read, the one reader of the rest.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderFunctions, wgslConstants } from '../../texture/shaderRule.fixture.ts'
import { contractLightingShader } from '../../gpu/core/shaderTexts.fixture.ts'
import { functionText } from '../../bounce/wgslBody.fixture.ts'

const surfaceOf = (shader: string) => shader.slice(shader.indexOf('fn lightSurface('))

test('the surface reads its cell once and sets up its shadow read behind the cell flag', () => {
  for (const [bounce, narrow, shadowed] of [
    [false, false, true],
    [true, true, true],
    [false, false, false],
  ] as const) {
    const shader = contractLightingShader(bounce, { narrow, unshadowed: !shadowed, lobeless: true })
    const surface = surfaceOf(shader)
    assert.ok(surface.includes('let cell=pixelCell(pixel.xy,z);let shadowed=cellShadowed(cell);'))
    assert.ok(surface.includes('if(shadowed){shadowSetup(coord,pixel);}'))
    assert.ok(surface.includes(',emissive.a,cell);'), 'the lighting takes the cell read')
    assert.doesNotMatch(surface, /shadowReceiver\(|shadowCamera=/)
    assert.doesNotMatch(shader, /pixelFootprint|shadowFootprint|shadowAngularPixel/)
    // The lighting finds no cell again, nor reads the flag again.
    assert.doesNotMatch(
      functionText(shader, 'contractLighting'),
      /gridCell|pixelCell|TILE_SHADOWED/,
    )
    const setup = functionText(shader, 'shadowSetup')
    // The mask's pixel first; the eye and receiver only for the translucent casters' read.
    assert.ok(setup.includes('{\n vsmMaskAt(coord);\n if(vsmTranslucentCasters()){'))
    const translucent = setup.slice(setup.indexOf('if(vsmTranslucentCasters()){'))
    for (const read of ['shadowCamera=view.camera.xyz;', 'shadowReceiver(pixel'])
      assert.ok(translucent.includes(read), read)
    const flag = shader.slice(shader.indexOf('fn cellShadowed(')).split('\n')[0]
    assert.equal(flag.includes('TILE_SHADOWED'), shadowed, 'the flag, read with shadow code')
    if (!shadowed) assert.equal(flag, 'fn cellShadowed(cell:u32)->bool{return false;}')
  }
})

test("cellShadowed reads its cell count's high bit: set where the list holds a shadowed light", () => {
  const shader = contractLightingShader(false)
  const K = wgslConstants(shader)
  const tileLights = new Uint32Array(3 * K.TILE_STRIDE)
  tileLights[K.TILE_STRIDE] = K.TILE_SHADOWED | 5 // the second cell: five lights, one shadowed
  tileLights[2 * K.TILE_STRIDE] = 5
  const { cellShadowed } = shaderFunctions<{ cellShadowed: (cell: number) => boolean }>(
    shader,
    ['cellShadowed'],
    { ...K, tileLights },
  )
  assert.deepEqual(
    [0, 1, 2].map((cell) => cellShadowed(cell * K.TILE_STRIDE)),
    [false, true, false],
  )
  assert.equal(cellShadowed(K.TILE_NO_SLICE), false, 'past the grid, or no light')
})
