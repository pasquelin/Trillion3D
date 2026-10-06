// Defect 10: under a negative-determinant transform, the CPU visibility raster (`rasterVisibility`)
// and the engine's own rasterisation on Dawn — `cullMode:'back'`, and the `frontFace` that
// `windingCw` flips (`../math/engineDraws.ts`) — draw the same clusters, and the normal cone culls
// none of them.
//
// The sample is defect 6's (`../math/inverseTransposeSample.ts`): 6 916 cases, 3 456 of them
// mirrored, from scale 1e-3 to 1e-16. Once, the CPU raster drew under a mirror the face every other
// path culls — 2 421 disagreements, all mirrored —, and the 54 clusters where the cone "dropped a
// visible face" were visible to that raster alone. The thesis that the cone's axis should be
// multiplied by `sign(det)` is refuted here: the raw orientation that accused the cone ignores the
// face swap, and every gap between it and the engine's draw is a mirror.
//
//   node bench/dawn/proofs.ts tests/gpu/pages/culled-face-reflection.gpu.ts
import test, { before } from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import { surfaceOf } from '../../../packages/sdk-browser/src/page/surface.ts'
import { rasterVisibility } from '../../../bench/oracles/browser/cpu-image/raster.ts'
import { coneDecision, rawOrientation, view, type Case } from '../math/inverseTransposeCases.ts'
import { ALL_CASES } from '../math/inverseTransposeSample.ts'
import { RASTER_VIEWPORT, engineDraws, rootsOf } from '../math/engineDraws.ts'

/** Every case's material: a front face. */
const FRONT = surfaceOf(G.basicSurface({ side: G.FRONT_SIDE }))

/** Whether the CPU raster draws the case, as a visibility page placed by its one root. */
function cpuDraws(lit: Case) {
  const geometry = new G.Geometry()
  geometry.setAttribute('position', G.floatAttribute(lit.positions, 3))
  const page = {
    array: new Uint32Array(lit.indices),
    attributes: geometry.attributes,
    material: FRONT,
  }
  const locations = { roots: rootsOf(lit), packed: [0], rootOfPacked: Int32Array.of(0) }
  return rasterVisibility([page], locations, view, RASTER_VIEWPORT).ids.some((id) => id !== 0)
}

const index = ALL_CASES.map((_, i) => i)
let gpu: boolean[] = [],
  cpu: boolean[] = [],
  coneCulls: boolean[] = []
before(async () => {
  gpu = (await engineDraws(ALL_CASES)).drawn
  cpu = ALL_CASES.map(cpuDraws)
  coneCulls = ALL_CASES.map((lit) => coneDecision(lit).coneCulls)
})
const count = (holds: (i: number) => boolean) => index.filter(holds).length
const mirrored = (i: number) => ALL_CASES[i].mirrored

test('the CPU raster and the engine draw the same clusters, and the cone culls none of them', () => {
  assert.ok(count(mirrored) > 3000, 'the sample holds thousands of mirrors')
  assert.deepEqual(
    index.filter((i) => cpu[i] !== gpu[i]),
    [],
    'the CPU raster culls the face the engine culls, under a mirror too',
  )
  assert.deepEqual(
    index.filter((i) => coneCulls[i] && (cpu[i] || gpu[i])),
    [],
    'the cone culls no cluster either path draws',
  )
  // Witnesses, or the equalities would be empty.
  assert.ok(count((i) => mirrored(i) && gpu[i]) > 0, 'mirrored clusters are drawn')
  assert.ok(count((i) => coneCulls[i]) > 0, 'the cone still culls clusters')
})

test('every gap between the raw orientation and what the engine draws is a mirror', () => {
  const raw = ALL_CASES.map((lit) => rawOrientation(lit).frontVisible)
  // The raw orientation still accuses the cone: it is the one ignoring the face swap.
  assert.ok(count((i) => coneCulls[i] && raw[i]) > 0, 'the raw orientation accuses the cone')
  const facingUndrawn = index.filter((i) => raw[i] && !gpu[i])
  assert.deepEqual(
    facingUndrawn.filter((i) => !mirrored(i)),
    [],
    'raw facing, undrawn: mirrors',
  )
  // And the gap plays both ways: the engine also draws what the raw orientation calls turned away.
  assert.ok(count((i) => !raw[i] && gpu[i]) > 0, 'the engine draws some faces raw calls away')
})
