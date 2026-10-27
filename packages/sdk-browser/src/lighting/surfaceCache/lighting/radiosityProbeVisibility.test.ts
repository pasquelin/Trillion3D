// The radiosity's probe occlusion reads the ray a line from a probe to a point falls on by the line's unit direction.
import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslModule } from '../../../../../math/src/wgsl/assemble.ts'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { radiosityCommonWgsl, radiosityProbeVisibilityWgsl } from './radiosityCommonWgsl.ts'

/** The probe at the origin facing +z (the basis is the identity there), its hemisphere 8 rays a side, the distance each row of rays met a
 *  surface at held in `rows`. */
function visibilityOf(rows: number[]) {
  const kit = shaderRun<{
    probeVisibility: (
      tested: number[],
      probe: { atlas: number[]; position: number[]; normal: number[] },
    ) => number
  }>(wgslModule(radiosityCommonWgsl(), radiosityProbeVisibilityWgsl(2)), ['probeVisibility'], {
    lp: { spacingShift: 0, hemisphere: 8, probeOcclusionStrength: 0.5 },
    probeHitDistance: { rows },
    textureLoad: (texture: { rows: number[] }, at: number[]) => [texture.rows[at[1]!]!, 0, 0, 0],
  })
  return (tested: number[]) =>
    kit.probeVisibility(tested, { atlas: [0, 0], position: [0, 0, 0], normal: [0, 0, 1] })
}

test('a point is seen along the ray its direction falls on, the height over the plane that of the unit direction, not of the distance in centimetres', () => {
  // A point 30, 40 and 20 centimetres off the probe lies 53.85 centimetres away: its unit direction is 0.371 high, the third row of eight
  // (0.371 · 8 = 2.97). Read raw, its height of 20 is held to 0.99 and it falls on the last row.
  const rows = Array<number>(8).fill(1000)
  rows[7] = 10
  const seen = visibilityOf(rows)
  assert.equal(seen([30, 40, 20]), 1, 'the third row met nothing nearer than the point')
  // The last row's surface lies nearer than the point, the third row's is as far as the point: the point is hidden along the third row alone.
  rows.fill(1000)
  rows[2] = 10
  assert.equal(visibilityOf(rows)([30, 40, 20]), 0, 'the third row met a surface nearer')
})
