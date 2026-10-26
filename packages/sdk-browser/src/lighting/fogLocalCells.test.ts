// What the local fog volumes add to the cells of the fog's volume, read along the one ray of a cell's pixel
// (`fog/gridWgsl.ts`), the shipped text run as shipped (`shaderRun`) with the scatter of `fogScatter.test.ts`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { near } from '../../../math/src/float/near.fixture.ts'
import { subtract } from '../../../math/src/vector/vectorTuple.ts'
import { shaderRun } from '../materials/texture/shaderRun.fixture.ts'
import { FOG_PROGRAMS } from './fog/programs.ts'
import { CAM, EYE, frameScope, image, pointOf, type V3 } from './fogVolumeRun.fixture.ts'
import { CELL, scatter } from './fogScatterRun.fixture.ts'
import { localSlots, placed } from './fogLocalRun.fixture.ts'

test('a cell a volume’s start distance cuts in two takes the share of its depth past it, read along the one ray of its pixel at the cell’s front, centre and back', () => {
  const run = shaderRun<{ fogCellPoint: (cell: V3, offset: V3) => number[] }>(
    FOG_PROGRAMS.scatter,
    ['fogCellPoint'],
    { frame: frameScope(image(CAM)), directLights: {}, fogDepth: {} },
  )
  const distance = (z: number) =>
    Math.hypot(...subtract(run.fogCellPoint(CELL, [0.5, 0.5, z]).slice(0, 3) as V3, EYE))
  const [front, back] = [distance(0), distance(1)]
  const P = pointOf(CELL)
  const stored = (volume: ReturnType<typeof placed>) =>
    scatter(CELL, { density: 0, localFog: localSlots([volume]).slots })![3]
  // Starting a quarter of the way into the cell, three quarters of it is the volume's.
  const whole = stored(placed('whole', P))
  assert.ok(whole > 0)
  near(
    [stored(placed('cut', P, { startDistance: front + 0.25 * (back - front) })) / whole],
    [0.75],
    'the share past the start',
    1e-5,
  )
  // The pixel’s ray is found once for the three depths, not once for each.
  const text = FOG_PROGRAMS.scatter
  const from = text.indexOf('fn fogLocalMedium(')
  const body = text.slice(from, text.indexOf('\n}', from))
  assert.equal(body.split('fogCellRay(').length - 1, 1, 'one ray')
  assert.ok(!body.includes('fogCellPoint('), 'no point found by its own ray')
})
