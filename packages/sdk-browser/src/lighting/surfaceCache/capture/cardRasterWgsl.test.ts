// The cards' capture draws every surface through the fixed-function path: no alpha mask cuts a row, no world position offset moves a vertex.
import test from 'node:test'
import assert from 'node:assert/strict'
import { assertProgramAssembles } from '../../../gpu/core/wgslNames.fixture.ts'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { NO_MASKS } from '../../../materials/graph/maskProgram.ts'
import { MODE_DEPTH, MODE_ID, rasterEntry } from '../../../visibility/raster/contract.ts'
import { rasterPixelWgsl } from '../../../visibility/raster/pixelWgsl.ts'
import { FLAG_MASK } from '../../../visibility/types.ts'
import { CARD_ROWS_ENTRY, cardRasterSource, cardRowsSource } from './cardRasterWgsl.ts'

for (const subgroups of [false, true])
  test(`the capture raster assembles, both phases declared, ${subgroups ? 'with' : 'without'} subgroups`, () => {
    const text = cardRasterSource(subgroups)
    for (const mode of [MODE_DEPTH, MODE_ID])
      assertProgramAssembles(text, rasterEntry(mode), 'the capture raster')
  })

test('the capture raster holds no alpha mask and no offset graph; no row is a cutout, whatever its flags', () => {
  const raster = cardRasterSource()
  // No mask is read nor any cutout taken; the shared triangle library still declares its cutout helper, which nothing here calls.
  assert.doesNotMatch(raster, /maskKeep|maskGraph|pageMaskUv|colorSample|=triCutout\(/)
  assert.match(raster, /let masked=false;/)
  // The default offset of zero is the only one in the program.
  assert.match(raster, /fn pageWpoLocal\([^)]*\)->vec3f\{return vec3f\(0\.0\);\}/)
  assert.equal(raster.match(/fn pageWpoLocal/g)?.length, 1)
  const rows = cardRowsSource()
  assertProgramAssembles(rows, CARD_ROWS_ENTRY, 'the capture rows')
})

test('a page flagged as a cutout writes its pixel in the capture raster, and is still cut by the camera raster', () => {
  const key = 0x3f000000 // the depth key of the plane 0.5
  /** The depth phase of one triangle of a page flagged `FLAG_MASK` over pixel (1, 1) of a 4 x 4 frame; returns the key written there. */
  const drawn = (program: Parameters<typeof shaderRun>[0], scope: object) => {
    const work = new Array<number>(32).fill(0)
    const run = shaderRun<{ writePixel: (...args: unknown[]) => void }>(program, ['writePixel'], {
      work,
      uni: { viewport: [4, 4] },
      pages: [{ flags: FLAG_MASK, depthBias: 0, packedBase: 0 }],
      ...scope,
    })
    const tri = { maxPixel: [3, 3], depth: [0.5, 0, 0], row: 0, triangle: 7 }
    run.writePixel(tri, [1, 1], [1, 0, 0], MODE_DEPTH)
    return work[1 * 4 + 1]
  }
  const cutout = (keeps: boolean) => ({
    maskKeep: () => keeps,
    triCutout: () => ({ at: [0, 0, 0], ddx: [0, 0], ddy: [0, 0] }),
  })
  assert.equal(drawn(cardRasterSource(), { cardRowView: { rect: [0, 0, 4, 4] } }), key)
  assert.equal(drawn(rasterPixelWgsl(NO_MASKS), cutout(false)), 0, 'the camera cuts the pixel')
  assert.equal(
    drawn(rasterPixelWgsl(NO_MASKS), cutout(true)),
    key,
    'or keeps it where the cutout does',
  )
})
