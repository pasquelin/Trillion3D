// The ray flag that lets a ray meet the stand-ins of first-person objects in the scene trace, which no other ray does (`ST_MEET_WORLD_SPACE`), the shipped
// `stEnter` run in JavaScript over one placement whose mark and record the test gives it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { RAY_TRACING_RECORD_AT } from '../../../../../sdk-core/src/contracts/rayTracingAbi.ts'
import { RAY_TRACING_RECORD_WORDS } from '../../../../../sdk-core/src/lighting/rayTracingFile.ts'
import { SHADOWLESS_ROOT, WORLD_SPACE_ROOT } from '../../../visibility/shader/castingMark.ts'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import type { Vec3 } from '../../../../../math/src/vector/vectorTuple.ts'
import { MISS, type Hit } from './sceneTraceHit.fixture.ts'
import { SCENE_TRACE_PROBE } from './sceneTraceProbe.fixture.ts'

const MEET_WORLD_SPACE = 64
const SKIP_TRANSLUCENT = 16

/** What the placement `0` meets: the ray's flags `flags`, the placement's mark `mark`; it holds a triangle at 5 m. `best` is what the ray
 *  met before. */
function enter(flags: number, mark: number, best: Hit) {
  // The table: the culling word of the placement (0, kept), its slot (the record 1), then the record, whose primitive has one node.
  const table = new Array<number>(2 * RAY_TRACING_RECORD_WORDS).fill(0)
  table[1] = 1
  table[RAY_TRACING_RECORD_WORDS + RAY_TRACING_RECORD_AT.nodeCount] = 1
  const met: Hit = { ...MISS, distance: 5, placement: 0, hit: true }
  const run = shaderRun<{ stEnter: (w: number, best: Hit, inverse: Vec3) => Hit }>(
    SCENE_TRACE_PROBE,
    ['stEnter'],
    {
      stDone: false,
      stRay: { origin: [0, 0, 0], direction: [1, 0, 0], tMin: 0, tMax: 1e4, flags },
      stParams: {
        placements: 1,
        cullWord: 0,
        placementWord: 1,
        worldRecord: 0,
        cellsWord: 0,
        cells: 0,
        eyeXY: [0, 0, 0, 0],
        eyeZ: [0, 0],
      },
      stTable: table,
      placementEnter: () => ({
        world: [],
        origin: [0, 0, 0],
        direction: [1, 0, 0],
        root: 0,
        mark,
        reach: 0,
        mirrored: false,
        found: true,
      }),
      stSkipsTranslucent: () => false,
      reachUnbounded: () => true,
      stVec3: () => [0, 0, 0],
      rayInverseDirection: () => [1, 1, 1],
      rayBoxEntry: () => 0,
      stBlas: () => met,
    },
  )
  return run.stEnter(0, best, [1, 1, 1])
}

const far: Hit = { ...MISS, distance: 1e4 }

test('the stand-in of a first-person object is met only by the rays that ask; any other placement is met by every ray', () => {
  const before: Hit = { ...MISS, distance: 7, placement: 3, hit: true }
  // A ray that does not ask passes the stand-in by: what it met before is what it has.
  assert.equal(enter(0, WORLD_SPACE_ROOT, far).hit, false)
  assert.equal(enter(SKIP_TRANSLUCENT, WORLD_SPACE_ROOT, far).hit, false, 'another flag is not it')
  assert.deepEqual(enter(0, WORLD_SPACE_ROOT | SHADOWLESS_ROOT, before), before)
  // A ray that asks meets it, 5 m away, nearer than what it met before.
  assert.equal(enter(MEET_WORLD_SPACE, WORLD_SPACE_ROOT, far).distance, 5)
  assert.equal(enter(MEET_WORLD_SPACE, WORLD_SPACE_ROOT, before).distance, 5)
  // A placement that is no stand-in is met either way.
  for (const flags of [0, MEET_WORLD_SPACE]) {
    assert.equal(enter(flags, 0, far).distance, 5)
    assert.equal(enter(flags, SHADOWLESS_ROOT, far).hit, true)
  }
})
