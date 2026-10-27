// The flicker measure's program, its own dispatch before the shading rejection's: what it writes,
// where it runs, and the cells of its output the shading rejection reads back.
import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslSource } from '../../../../math/src/wgsl/source.fixture.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { flickerErrorWords, FLICKER_PLANES } from './flickerErrorCells.ts'
import { FLICKER_MEASURE_BINDINGS, flickerMeasureShader } from './flickerMeasureWgsl.ts'
import { REJECT_SHADING_BINDINGS, rejectShadingShader } from './rejectionWgsl.ts'
import { REJECT_SHADING_STRIDE, REJECT_SHADING_TILE } from './rejectionNetworkWgsl.ts'

const FULL = wgslSource(flickerMeasureShader())
const HALF = wgslSource(flickerMeasureShader(true))
const REJECT = wgslSource(rejectShadingShader('rgba8unorm', 'rgba16float'))
const REJECT_HALF = wgslSource(rejectShadingShader('rgba8unorm', 'rgba16float', true))

test('the measure has no gate of its own: the dispatch is left out where it is not asked, and the rejection reads its errors only where it ran', () => {
  // `analysis.ts` leaves the dispatch out where neither `view.quality.x` nor an analysis view asks
  // for it (`AnalysisWork.flicker`): the program starts on its tile.
  const head = /fn measureFlicker\([^\n]*\)\{\n laneX=/
  assert.match(FULL, head)
  assert.match(HALF, head)
  // The conditions are written once, and both programs hold them.
  for (const text of [FULL, HALF, REJECT, REJECT_HALF]) {
    assert.match(text, /fn flickerRejects\(\)->bool\{return view\.quality\.x>0\.0;\}/)
    assert.match(text, /fn analysisShown\(\)->bool\{return view\.params\.w>=4\.0;\}/)
    assert.match(
      text,
      /fn flickerMeasured\(\)->bool\{return flickerRejects\(\)\|\|analysisShown\(\);\}/,
    )
    assert.equal(text.match(/view\.quality\.x/g)?.length, 1)
    assert.equal(text.match(/view\.params\.w>=4\.0/g)?.length, 1)
  }
  // The rejection reads the errors where the measure ran and holds none else.
  assert.match(
    REJECT,
    /var cellError:array<f32,4>;\n if\(flickerMeasured\(\)\)\{\n {2}for\(var r=0;r<4;r\+\+\)\{cellError\[r\]=flickerError\[flickerCell\(wg,groups,laneRow\+r,laneX,0u\)\];\}/,
  )
  assert.match(REJECT, /let flickerOn=flickerRejects\(\);/)
})

test('the measure writes the flicker history and the errors, the rejection neither computes nor writes them', () => {
  for (const text of [FULL, HALF]) {
    assert.match(text, /textureStore\(flickerOut,g,vec4f\(/)
    assert.match(
      text,
      /flickerError\[flickerCell\(wg,groups,laneRow\+r,laneX,0u\)\]=f32\(cellError\);/,
    )
    assert.match(
      text,
      /if\(analysisShown\(\)\)\{flickerError\[flickerCell\(wg,groups,laneRow\+r,laneX,1u\)\]=f32\(cellCount\);\}/,
    )
  }
  for (const text of [REJECT, REJECT_HALF]) {
    assert.doesNotMatch(
      text,
      /flickerOut|measuredLuma|var flicker:|FLICKER_GHOSTING|var<storage,read_write> flickerError/,
    )
    assert.match(text, /var<storage,read> flickerError:array<f32>;/)
    assert.match(text, /let count=flickerError\[flickerCell\(wg,groups,laneRow\+r,laneX,1u\)\];/)
  }
  // The measure's values reach the rejection in 32 bits, whatever the precision they were computed in.
  assert.match(HALF, /var relax:array<f16,4>/)
  assert.doesNotMatch(wgslSource(flickerMeasureShader()), /f16/)
})

test('the measure and the rejection tile the render texels the same way', () => {
  for (const text of [FULL, REJECT]) {
    assert.match(text, /let origin=vec2i\(wg\.xy\)\*26-vec2i\(3\);/)
    assert.match(text, /@workgroup_size\(256\)/)
    assert.match(text, /@builtin\(num_workgroups\) groups:vec3u/)
  }
  assert.equal(REJECT_SHADING_STRIDE, 26)
})

test('the measure declares the bindings its layout names, and the rejection the error buffer read only', () => {
  const declared = (text: string) =>
    [...text.matchAll(/@binding\((\d+)\) var(?:<[^>]*>)? (\w+)/g)].map((m) => [Number(m[1]), m[2]])
  assert.deepEqual(
    declared(FULL).sort((a, b) => Number(a[0]) - Number(b[0])),
    [
      [FLICKER_MEASURE_BINDINGS.view, 'view'],
      [FLICKER_MEASURE_BINDINGS.current, 'current'],
      [FLICKER_MEASURE_BINDINGS.translucency, 'translucency'],
      [FLICKER_MEASURE_BINDINGS.word, 'reprojected'],
      [FLICKER_MEASURE_BINDINGS.flicker, 'flicker'],
      [FLICKER_MEASURE_BINDINGS.marks, 'marks'],
      [FLICKER_MEASURE_BINDINGS.thin, 'thin'],
      [FLICKER_MEASURE_BINDINGS.measureLuma, 'measuredLuma'],
      [FLICKER_MEASURE_BINDINGS.flickerOut, 'flickerOut'],
      [FLICKER_MEASURE_BINDINGS.flickerError, 'flickerError'],
    ],
  )
  assert.ok(
    declared(REJECT).some(
      ([at, name]) => at === REJECT_SHADING_BINDINGS.flickerError && name === 'flickerError',
    ),
  )
  assert.equal(
    new Set(Object.values(REJECT_SHADING_BINDINGS)).size,
    Object.keys(REJECT_SHADING_BINDINGS).length,
  )
})

test('each cell of the measure’s output is one texel of one workgroup’s tile, in the plane it is read from', () => {
  const { flickerCell } = shaderRun<{
    flickerCell: (wg: number[], groups: number[], row: number, x: number, plane: number) => number
  }>(FULL, ['flickerCell'], {})
  const groups = [3, 2, 1]
  const cellsOf = (plane: number) => {
    const cells = new Set<number>()
    for (let y = 0; y < groups[1]; y++)
      for (let x = 0; x < groups[0]; x++)
        for (let row = 0; row < REJECT_SHADING_TILE; row++)
          for (let column = 0; column < REJECT_SHADING_TILE; column++)
            cells.add(flickerCell([x, y, 0], groups, row, column, plane))
    return cells
  }
  const seen = new Set(Object.values(FLICKER_PLANES).flatMap((plane) => [...cellsOf(plane)]))
  const [width, height] = [groups[0] * REJECT_SHADING_STRIDE, groups[1] * REJECT_SHADING_STRIDE]
  const words = flickerErrorWords(width, height, true)
  assert.equal(words, 2 * 6 * REJECT_SHADING_TILE * REJECT_SHADING_TILE)
  assert.equal(seen.size, words, 'no two texels share a cell')
  assert.equal(Math.max(...seen), words - 1, 'and none is past the buffer')
  // The count's plane is the buffer's second half: the error's alone fits the buffer made without it.
  const errors = flickerErrorWords(width, height, false)
  assert.equal(errors, words / 2)
  assert.equal(Math.max(...cellsOf(FLICKER_PLANES.error)), errors - 1)
  // A render size a texel past a stride makes another workgroup, a texel less none.
  assert.equal(
    flickerErrorWords(width + 1, height, true),
    2 * 8 * REJECT_SHADING_TILE * REJECT_SHADING_TILE,
  )
})
