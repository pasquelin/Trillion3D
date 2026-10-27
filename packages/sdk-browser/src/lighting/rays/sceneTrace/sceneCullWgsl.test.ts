// The scene trace's culling of the placements (`sceneCullWgsl.ts`): the program assembles and binds what its layout
// describes; the shipped WGSL, run in JavaScript, culls a placement as the reference's two tests do — the primitive's
// bounds (`ShouldCullBounds`) then the instance's (`CullInstance`) — which a twin written from their formulas states
// independently, on chosen placements and on placements drawn at random.

import test from 'node:test'
import assert from 'node:assert/strict'
import { lcgRandom } from '../../../../../math/src/sequence/random.ts'
import { assertProgramAssembles, topLevelNames } from '../../../gpu/core/wgslNames.fixture.ts'
import { dagReadLayoutEntries } from '../../../geometry/dag/shader/bindings.ts'
import { placement, poseOf } from '../../../geometry/dag/shader/drawDistance.fixture.ts'
import {
  SCENE_CULL_ENTRY,
  SCENE_CULL_MODE,
  SCENE_CULL_WGSL,
  sceneCullLayoutEntries,
} from './sceneCullWgsl.ts'
import { SCENE_TRACE_PARAMS } from './sceneTraceWgsl.ts'
import {
  DEFAULTS,
  cube,
  shipped,
  twin,
  type Culling,
  type Placed,
} from './sceneCullTwin.fixture.ts'

test('the program assembles and names the pass’s entry, its group and its bindings', () => {
  assertProgramAssembles(SCENE_CULL_WGSL)
  assert.ok(topLevelNames(SCENE_CULL_WGSL).includes(SCENE_CULL_ENTRY))
  const declared = [
    ...SCENE_CULL_WGSL.matchAll(/@group\((\d+)\) @binding\((\d+)\) var(?:<(\w+))?/g),
  ].map((m) => [Number(m[1]), Number(m[2]), m[3]] as const)
  const entries = sceneCullLayoutEntries()
  assert.deepEqual(
    declared
      .filter(([group]) => group === 1)
      .map(([, binding]) => binding)
      .sort(),
    entries.map(({ binding }) => binding).sort(),
  )
  assert.deepEqual(
    entries.map((e) => e.buffer?.type),
    ['uniform', 'storage'],
  )
  // The cut's tables are group 0, at the culling's bindings; the pass writes the table, so it declares it writable.
  assert.deepEqual(
    declared
      .filter(([group]) => group === 0)
      .map(([, binding]) => binding)
      .sort(),
    dagReadLayoutEntries()
      .map(({ binding }) => binding)
      .sort(),
  )
  assert.match(SCENE_CULL_WGSL, /var<storage,read_write> stCulled:array<u32>/)
  assert.doesNotMatch(SCENE_CULL_WGSL, /stTable/)
  assert.ok(SCENE_TRACE_PARAMS.at.cullWord < SCENE_TRACE_PARAMS.words)
})

test('the modes are the reference’s: none, behind the camera, far and small, far or small', () => {
  assert.deepEqual(Object.values(SCENE_CULL_MODE), [0, 1, 2, 3])
  const far = cube(1000, 50), // large and far
    small = cube(100, 0.5), // near enough, tiny: half a metre at 100 is 0.29 degrees
    both = cube(1000, 0.5),
    ahead = cube(100, 20)
  const culls = (p: Placed, mode: number) => shipped(p, { ...DEFAULTS, mode })
  for (const p of [far, small, both, ahead]) assert.equal(culls(p, 0), false)
  // Mode 3: far OR small.
  assert.deepEqual(
    [far, small, both, ahead].map((p) => culls(p, 3)),
    [true, true, true, false],
  )
  // Mode 2: far AND small (an instance, then, is culled by far and small alone as well).
  assert.deepEqual(
    [far, small, both, ahead].map((p) => culls(p, 2)),
    [false, false, true, false],
  )
  // Mode 1: only what lies behind the camera; what is ahead stays whatever it is.
  assert.deepEqual(
    [far, small, both].map((p) => culls(p, 1)),
    [false, false, false],
  )
  const behind = cube(1000, 0.5, [0, 0, 1])
  assert.equal(culls(behind, 1), true, 'far, small and behind')
  assert.equal(culls(cube(100, 20, [0, 0, 1]), 1), false, 'behind, but near and large')
  for (const p of [far, small, both, ahead, behind, cube(100, 20, [0, 0, 1])])
    for (const mode of [0, 1, 2, 3])
      assert.equal(culls(p, mode), twin(p, { ...DEFAULTS, mode }), `twin, mode ${mode}`)
})

test('an object nearer than its least draw distance is culled where the switch is on; an instance of a mesh by its own distances', () => {
  const named = cube(20, 5, [0, 0, -1], { near: 50 })
  assert.equal(shipped(named, DEFAULTS), true)
  assert.equal(shipped(named, { ...DEFAULTS, minDraw: false }), false)
  assert.equal(
    shipped({ ...named, instance: true }, DEFAULTS),
    true,
    'an instance nearer than its least',
  )
  assert.equal(
    shipped({ ...named, instance: true }, { ...DEFAULTS, minDraw: false }),
    true,
    'an instance’s distances, whatever the switch',
  )
  assert.equal(shipped(cube(20, 5), DEFAULTS), false, 'none named')
  // A mode 1 considers it, in front of the camera, for its least draw distance alone.
  assert.equal(shipped(named, { ...DEFAULTS, mode: 1 }), true)
  assert.equal(shipped(named, { ...DEFAULTS, mode: 1, minDraw: false }), false)
  for (const minDraw of [true, false])
    for (const mode of [1, 2, 3])
      assert.equal(
        shipped(named, { ...DEFAULTS, mode, minDraw }),
        twin(named, { ...DEFAULTS, mode, minDraw }),
      )
})

test('an instance of a mesh is seen between its draw distances alone, from its centre, at the view’s scale', () => {
  // Large and near enough to be seen by the modes 2 and 3: its draw distances alone decide.
  const at = (distance: number, extra: Partial<Placed>) =>
    cube(distance, 20, [0, 0, -1], { near: 0, instance: true, ...extra })
  const cases: [Placed, Culling, boolean][] = [
    [at(100, { near: 50, far: 200 }), DEFAULTS, false],
    [at(100, { near: 150, far: 200 }), DEFAULTS, true],
    [at(100, { near: 50, far: 80 }), DEFAULTS, true],
    [at(100, { far: 0 }), DEFAULTS, false],
    // A far distance of 0 names no end, as the cut reads it: the near one alone culls.
    [at(100, { near: 150, far: 0 }), DEFAULTS, true],
    [at(100, { near: 50, far: 0 }), DEFAULTS, false],
    // On either end the instance is seen: the reference keeps the squares' equality.
    [at(100, { near: 100, far: 200 }), DEFAULTS, false],
    [at(100, { near: 50, far: 100 }), DEFAULTS, false],
    // With the host's switch off, the cut draws it whatever its distances, and so the rays meet it.
    [at(100, { near: 150, far: 200 }), { ...DEFAULTS, instances: false }, false],
    // At half the scale the far end comes to 40 m; at twice it, the near end to 120 m.
    [at(100, { near: 50, far: 80 }), { ...DEFAULTS, scale: 0.5 }, true],
    [at(30, { far: 80 }), { ...DEFAULTS, scale: 0.5 }, false],
    [at(100, { near: 60, far: 400 }), { ...DEFAULTS, scale: 2 }, true],
    // The modes that do not test instances leave its distances to the cut.
    [at(100, { near: 150, far: 200 }), { ...DEFAULTS, mode: 1 }, false],
  ]
  for (const [p, c, culled] of cases) {
    assert.equal(shipped(p, c), culled, `${p.near}–${p.far} at ${c.scale}, mode ${c.mode}`)
    assert.equal(twin(p, c), culled, `twin ${p.near}–${p.far} at ${c.scale}, mode ${c.mode}`)
  }
})

test('the distance is taken to the box or to the sphere, as the switch says', () => {
  // A long pole: its sphere reaches the eye, its box does not (the pole lies 400 m off, 1000 m long).
  const pole: Placed = {
    m: poseOf([400, 0, 0]),
    low: [-0.5, -500, -0.5],
    high: [0.5, 500, 0.5],
  }
  const c = { ...DEFAULTS, mode: 3, angle: 0 }
  assert.equal(shipped(pole, { ...c, box: true }), true, 'the box is 400 m off')
  assert.equal(shipped(pole, { ...c, box: false }), false, 'the sphere reaches the eye')
  for (const box of [true, false])
    assert.equal(shipped(pole, { ...c, box }), twin(pole, { ...c, box }))
})

test('the shipped program culls as the twin does on placements drawn at random, every mode and switch', () => {
  const next = lcgRandom(11)
  let culled = 0,
    kept = 0
  for (let n = 0; n < 1500; n++) {
    const { m, low, high } = placement(next, 400)
    const p: Placed = {
      m,
      low,
      high,
      ...(next() < 0.3 ? { near: next() * 400, far: next() < 0.5 ? 0 : 200 + next() * 600 } : {}),
      instance: next() < 0.3,
    }
    const c: Culling = {
      mode: Math.floor(next() * 4),
      radius: 100 + next() * 400,
      angle: next() * 6,
      box: next() < 0.5,
      minDraw: next() < 0.5,
      direction: [0, 0, -1],
      scale: 0.5 + next() * 1.5,
      instances: next() < 0.7,
    }
    const got = shipped(p, c)
    assert.equal(got, twin(p, c), `placement ${n}`)
    if (got) culled++
    else kept++
  }
  assert.ok(culled > 200 && kept > 200, `${culled} culled, ${kept} kept`)
})
