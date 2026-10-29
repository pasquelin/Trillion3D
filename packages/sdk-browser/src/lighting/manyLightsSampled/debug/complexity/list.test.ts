import test from 'node:test'
import assert from 'node:assert/strict'
import { COMPLEXITY_KIND, type ComplexityLight, type ComplexityList } from './entries.ts'
import { dumpText, headerRows, listOrigin, rowPrefix, selectedLight } from './list.ts'
import { TEXT_LINE } from '../../../../diagnostic/textOverlay.ts'

const light = (
  rank: number,
  kind: number,
  weight: number,
  place: [number, number, number],
  seen = 1,
): ComplexityLight => ({
  rank,
  seen,
  kind,
  weight,
  place,
  color: [1, 1, 1],
})
const list: ComplexityList = {
  written: true,
  valid: true,
  position: [0, 0, 0],
  sum: 4,
  lights: [
    light(0, COMPLEXITY_KIND.point, 3, [0, 0, 10]),
    light(1, COMPLEXITY_KIND.spot, 1, [5, 0, 0], 0.5),
    light(2, COMPLEXITY_KIND.directional, 0, [0, 1, 0], 0),
  ],
}
const names = (rank: number) => ['Lamp', 'Spot A', 'Sun'][rank]!
const SIZE = [1920, 1080] as const

test('a row writes the share, the visibility and the kind in fixed columns before the name', () => {
  assert.equal(rowPrefix(list.lights[0]!, list.sum), '  0.7500  1.00Point  ')
  assert.equal(rowPrefix(list.lights[1]!, list.sum), '  0.2500  0.50Spot   ')
  assert.equal(rowPrefix(list.lights[2]!, list.sum), '  0.0000  0.00Dir    ')
  // A row's three columns are 21 characters, whatever the numbers.
  assert.equal(rowPrefix(list.lights[1]!, list.sum).length, 21)
})

test('the three lines above the lights name the pixel, the count and the columns, or the frozen data', () => {
  assert.deepEqual(headerRows([960, 540], 3, false), [
    'ScreenCoord: 960 540',
    'NumLights: 3',
    'Ratio | Vis | Type | Name',
  ])
  assert.equal(headerRows([0, 0], 0, true)[0], 'Displaying frozen data...')
})

test('the list starts a twentieth in', () => {
  assert.deepEqual(listOrigin(SIZE), [96, 54])
})

test('the cursor selects the light whose row it is in, else the nearest whose sphere its ray crosses', () => {
  const pick = (cursor: [number, number], origin: number[], direction: number[], shown = 3) =>
    selectedLight(list, shown, names, SIZE, cursor, origin, direction)
  const [x0, y0] = listOrigin(SIZE)
  const row = (index: number) => y0 + (3 + index) * TEXT_LINE
  const width = (rowPrefix(list.lights[1]!, 4) + names(1)).length * 8
  // On the second row's text: that light, whatever the ray; a row stands one line below the one before.
  assert.equal(pick([x0 + 5, row(1) + 5], [0, 0, 0], [0, 1, 0]), 1)
  assert.equal(pick([x0 + 5, row(0) + 5], [0, 0, 0], [0, 1, 0]), 0)
  // Past the end of the text, or on the line above the first row, the row is not the cursor's.
  assert.equal(pick([x0 + width + 5, row(1) + 5], [0, 0, 0], [0, 1, 0]), -1)
  assert.equal(pick([x0 + 5, row(0) - 5], [0, 0, 0], [0, 1, 0]), -1)
  // A sphere behind the ray is not crossed.
  assert.equal(pick([1000, 900], [0, 0, 0], [0, 0, -1]), -1)
  // Off the list, the ray along z crosses the point light's sphere (at z = 10).
  assert.equal(pick([1000, 900], [0, 0, 0], [0, 0, 1]), 0)
  // Along x it crosses the spot's.
  assert.equal(pick([1000, 900], [0, 0, 0], [1, 0, 0]), 1)
  // The directional light has no sphere; a ray that crosses nothing selects nothing.
  assert.equal(pick([1000, 900], [0, 0, 0], [0, 1, 0]), -1)
  // Only the lights shown can be selected.
  assert.equal(pick([1000, 900], [0, 0, 0], [1, 0, 0], 1), -1)
})

test('the dump writes the lights in the reference’s columns, the share over the sum held to a millionth', () => {
  const text = dumpText(list, names)
  const rows = text.split('\n')
  assert.equal(rows[1], 'NumLights: 3')
  assert.match(
    rows[2]!,
    /^LightName \| WeightRatio \(Weight\) \| Visibility \| LightType \| WorldPosition or Direction$/,
  )
  assert.match(
    rows[3]!,
    /^ {5}Lamp , {8}0\.750 \(3\.000\) , {6}1\.000 , {5}Point , \(0\.000, 0\.000, 10\.000\)$/,
  )
  assert.match(rows[5]!, / Dir , \(0\.000, 1\.000, 0\.000\)$/)
})
