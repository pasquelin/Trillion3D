// A local light's back-face test is one function (`VSM_PROJECTION_DATA_WGSL`), which the marking and
// the trace's region test both call with the vector from the point to the light: the marking skips
// a pixel's page exactly where the projection traces no ray for it. Before, the marking held a copy
// that took the unit direction and added 1 m² where the shared one adds 1 cm² — the nearInverse of a
// light at a distance of one metre whatever its distance —, so it culled differently (an approved
// image change: which grazing back faces the marking skips, hence which pages it marks).
import test from 'node:test'
import assert from 'node:assert/strict'
import { functionText } from '../bounce/wgslBody.fixture.ts'
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import { F32_SCOPE } from '../lighting/shaderRunF32.fixture.ts'
import { vsmPixelPageMarkingWgsl } from './markingWgsl.ts'
import { vsmProjectionWgsl } from './projectionWgsl.ts'
import { seeded } from './planFrames.fixture.ts'
import { vsmLayout } from './layout.ts'
import { saturate } from '../../../math/src/scalar/reals.ts'

const LAYOUT = vsmLayout({ fullMapCapacity: 63, sunMapCapacity: 18 }, 2 ** 27)
const MARKING = vsmPixelPageMarkingWgsl(LAYOUT),
  PROJECTION = vsmProjectionWgsl(LAYOUT, { subgroups: false })
type V3 = [number, number, number]
type Backface = (toLight: V3, normal: V3, radius: number) => boolean
const run = (code: string) =>
  shaderRun<{ vsmFacesAwayFromLocal: Backface }>(code, ['vsmFacesAwayFromLocal'], {
    ...F32_SCOPE,
  }).vsmFacesAwayFromLocal

/** The marking's copy before: its nearInverse of 1 m², fed the unit direction. */
const before = (d: V3, n: V3, r: number) => {
  const f = Math.fround
  const len = Math.hypot(...d)
  const u = d.map((x) => f(x / len))
  const rangeSq = f(u[0] * u[0] + u[1] * u[1] + u[2] * u[2])
  const emitterSin = Math.sqrt(saturate(f(r * r) / (rangeSq + 1)))
  return n[0] * u[0] + n[1] * u[1] + n[2] * u[2] < -emitterSin
}

test('the marking and the trace call the one back-face test, with the vector to the light', () => {
  for (const code of [MARKING, PROJECTION])
    assert.equal(code.split('fn vsmFacesAwayFromLocal(').length, 2, 'one definition')
  assert.equal(
    functionText(MARKING, 'vsmFacesAwayFromLocal'),
    functionText(PROJECTION, 'vsmFacesAwayFromLocal'),
  )
  assert.ok(MARKING.includes('vsmFacesAwayFromLocal(d,worldNormal,sourceRadius)'))
  assert.ok(MARKING.includes('let d=lightShiftedPosition-shiftedPosition;'))
  assert.ok(PROJECTION.includes('let toLight=light.shiftedPosition-shiftedPositionIn;'))
  assert.ok(
    PROJECTION.includes('vsmFacesAwayFromLocal(toLight,info.worldNormal,light.sourceRadius)'),
  )
})

test('on generated points, normals and lamps, the marking skips exactly the faces the trace does', () => {
  const marking = run(MARKING),
    trace = run(PROJECTION)
  const rand = seeded(1305)
  let changed = 0,
    culled = 0
  for (let k = 0; k < 4000; k++) {
    // Lamps from a centimetre to forty metres away, of emitter radii up to a metre and a half.
    const distance = 0.01 * 4000 ** rand(),
      radius = 1.5 * rand() ** 2
    const dir = [rand() - 0.5, rand() - 0.5, rand() - 0.5],
      len = Math.hypot(...dir)
    const d = dir.map((x) => Math.fround((x / len) * distance)) as V3
    const raw = [rand() - 0.5, rand() - 0.5, rand() - 0.5],
      nl = Math.hypot(...raw)
    const n = raw.map((x) => Math.fround(x / nl)) as V3
    const r = Math.fround(radius)
    assert.equal(marking(d, n, r), trace(d, n, r), `${d} ${n} ${r}`)
    culled += trace(d, n, r) ? 1 : 0
    changed += before(d, n, r) !== trace(d, n, r) ? 1 : 0
  }
  // The old copy disagreed with the trace on a share of the grazing faces: the image change.
  assert.ok(culled > 500 && changed > 0, `${culled} culled, ${changed} changed`)
})
