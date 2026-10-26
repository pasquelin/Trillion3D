// A vertex is placed where its surface's offset puts it (`pagePosition`, `wpoGraphWgsl.ts`): the
// shipped hook is run in JavaScript over the offset programs of a session's surfaces, its row's
// distance, bounds and cuts, the clocks and the camera of the image and of the image before.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { Mat } from '../../materials/texture/shaderRunMatrix.fixture.ts'
import { VIS_SHADER } from './visShader.fixture.ts'
import { FLAG_VOXEL, WPO_ROW_ALWAYS, WPO_ROW_MOVES, WPO_ROW_VELOCITY } from '../types.ts'
import { material } from '../../../../sdk-core/src/world/material/index.ts'
import { wpoProgramOf } from '../../materials/graph/wpoProgram.ts'
import { graphRastersOf } from '../../materials/graph/graphRasters.ts'
import { GRAPH_HEADER } from '../../materials/table/materialLayout.ts'
import { visibilityWpo, voxelWpo } from './wpoSets.ts'
import { visVoxelShader } from './visVoxelWgsl.ts'
import { followingProgram, held, offsetAt, slides } from './wpoHook.fixture.ts'

test('a vertex moves by its surface’s offset, brought from the world into the primitive’s space', () => {
  const program = slides()
  // Time 3 along x in the world, a quarter along y: half as far in a primitive scaled by two.
  assert.deepEqual(offsetAt(program, {}, {}, { scale: 2 }), [1.5, 0.125, 0])
  assert.deepEqual(offsetAt(program, {}, { time: 1 }, { uv: [0, 1] }), [1, 1, 0])
})

test('the offset is held to the greatest the object’s surfaces allow, and none off its header', () => {
  const program = slides()
  assert.deepEqual(offsetAt(program, { most: 1 }), [1, 0.25, 0], 'held along each axis')
  assert.deepEqual(
    offsetAt(program, {}, {}, { header: [program.key, 0, 0, 0] }),
    [3, 0.25, 0],
    'a surface of the opaque pass',
  )
  assert.deepEqual(
    offsetAt(program, {}, {}, { header: [program.key, GRAPH_HEADER.blend, 0, 0] }),
    [0, 0, 0],
    'the transparent pass’s program of that number is no other',
  )
  assert.deepEqual(
    offsetAt(program, {}, {}, { header: [program.key + 7, 0, 0, 0] }),
    [0, 0, 0],
    'a program the module does not hold',
  )
})

test('the offset stops past its distance, measured from the camera to the centre of the object’s bounds, unless the surface always evaluates', () => {
  const program = slides()
  const camera = { eye: [20, 0, 0] }
  // The pivot is 20 from the camera, the centre of the bounds 10: a stop at 15 keeps it.
  assert.deepEqual(offsetAt(program, { stops: 15, centre: [10, 0, 0] }, camera), [3, 0.25, 0])
  assert.deepEqual(
    offsetAt(program, { stops: 15, centre: [0, 0, 0] }, camera),
    [0, 0, 0],
    'the centre at the pivot is 20 away',
  )
  assert.deepEqual(offsetAt(program, { stops: 0, centre: [0, 0, 0] }, camera), [3, 0.25, 0], 'none')
  assert.deepEqual(
    offsetAt(program, { wpo: WPO_ROW_MOVES | WPO_ROW_ALWAYS, stops: 15 }, camera),
    [3, 0.25, 0],
    'always',
  )
})

test('a shadow pass judges the offset by its map’s threshold, never by the camera', () => {
  const program = slides()
  const far = { stops: 10, eye: [500, 0, 0] }
  // The threshold is the square of a distance: allowed while it is not past the object’s own.
  assert.deepEqual(offsetAt(program, far, far, { threshold: 100 }), [3, 0.25, 0], 'at the square')
  assert.deepEqual(offsetAt(program, far, far, { threshold: 4 }), [3, 0.25, 0], 'a finer level')
  assert.deepEqual(offsetAt(program, far, far, { threshold: 101 }), [0, 0, 0], 'a coarser level')
  assert.deepEqual(
    offsetAt(program, { ...far, wpo: WPO_ROW_MOVES | WPO_ROW_ALWAYS }, far, { threshold: 1e6 }),
    [3, 0.25, 0],
    'always',
  )
  assert.deepEqual(offsetAt(program, { stops: 0 }, far, { threshold: 1e6 }), [3, 0.25, 0], 'none')
})

test('the offset of the image before is read at its clocks and its camera, under the current image’s distance', () => {
  const program = slides()
  const world = { time: 5, before: { time: 4.5, eye: [0, 0, 0] } }
  assert.deepEqual(offsetAt(program, {}, world), [5, 0.25, 0])
  assert.deepEqual(offsetAt(program, {}, world, { previous: true }), [4.5, 0.25, 0])
  // The camera was within the distance before and is past it now: the offset is none in both, the
  // velocity none; and the camera within it now and past it before: it is evaluated in both.
  const now = { stops: 10, centre: [0, 0, 0] }
  const away = { time: 5, eye: [20, 0, 0], before: { time: 4.5, eye: [0, 0, 0] } }
  assert.deepEqual(offsetAt(program, now, away, { previous: true }), [0, 0, 0])
  const near = { time: 5, eye: [0, 0, 0], before: { time: 4.5, eye: [20, 0, 0] } }
  assert.deepEqual(offsetAt(program, now, near, { previous: true }), [4.5, 0.25, 0])
})

test('the offset of the image before is evaluated where the object was: the placement’s motion takes the world back', () => {
  const followed = followingProgram()
  // The vertex is at x = 5; the object was 2 to the left (relative to the eye) in the image before.
  const moved = new Mat([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -2, 0, 0, 1])
  assert.deepEqual(offsetAt(followed, {}, {}, { local: [5, 0, 0] }), [0, 5, 0], 'now')
  assert.deepEqual(
    offsetAt(followed, {}, {}, { local: [5, 0, 0], previous: true, still: moved }),
    [0, 3, 0],
    'before: its world position taken back by the motion',
  )
  // A scaled object’s previous offset is brought into the primitive’s space by the previous world.
  const wide = new Mat([2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1])
  assert.deepEqual(
    offsetAt(followed, {}, {}, { local: [1, 0, 0], previous: true, still: wide }),
    [0, 1, 0],
    'the vertex at 2 in the world offsets by 2: 1 in a primitive twice as large',
  )
})

test('a page position asks the offset of a row that has one, a velocity row asking the previous too', () => {
  const calls: [boolean, unknown][] = []
  const position = shaderRun<{
    pagePosition: (...a: unknown[]) => number[]
    pagePreviousPosition: (...a: unknown[]) => number[]
  }>(VIS_SHADER, ['pagePosition', 'pagePreviousPosition'], {
    pageRestPosition: () => [1, 2, 3],
    pageDeformed: () => [4, 5, 6],
    pageWpoLocal: (
      _p: unknown,
      _h: unknown,
      _v: unknown,
      _l: unknown,
      previous: boolean,
      before: unknown,
    ) => (calls.push([previous, before]), [0.5, 0, 0]),
  })
  const row = (wpo: number, deformed = 0) => ({ wpo, deformOutput: deformed })
  assert.deepEqual(position.pagePosition(row(0), {}, 0), [1, 2, 3])
  assert.equal(calls.length, 0, 'a row of no offset asks none')
  assert.deepEqual(position.pagePosition(row(WPO_ROW_MOVES), {}, 0), [1.5, 2, 3])
  assert.deepEqual(
    position.pagePosition(row(WPO_ROW_MOVES, 1), {}, 0),
    [4.5, 5, 6],
    'after its deformation',
  )
  assert.deepEqual(
    calls.map(([previous]) => previous),
    [false, false],
    'the image drawn',
  )
  const motion = new Mat([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 3, 0, 0, 1])
  position.pagePreviousPosition(row(WPO_ROW_MOVES | WPO_ROW_VELOCITY), {}, 0, motion)
  position.pagePreviousPosition(row(WPO_ROW_MOVES), {}, 0, motion)
  assert.deepEqual(
    calls.slice(2).map(([previous]) => previous),
    [true, false],
    'the image before, only where the offset is a motion',
  )
  assert.equal(calls[2]![1], motion, 'with the placement’s motion')
})

test('the offsets a module holds are those of the session’s surfaces: a stale program is in none, one that joins later in none made before', () => {
  const known = slides()
  const stale = material.graph('surface')
  stale.output('worldPositionOffset', stale.multiply(stale.time(), stale.constant(0, 1, 0)))
  const compiled = wpoProgramOf({ graph: stale })
  assert.ok(compiled && compiled.key !== known.key, 'a program compiled, worn by no surface')
  const rasters = graphRastersOf([{ graph: held.get(known.key) }])
  assert.deepEqual(
    visibilityWpo(rasters).programs.map((p) => p.key),
    [known.key],
    'only the program the session’s surface wears',
  )
  const joined = material.graph('surface')
  joined.output('worldPositionOffset', joined.multiply(joined.time(), joined.constant(2, 0, 0)))
  const after = wpoProgramOf({ graph: joined })!
  assert.ok(
    !visibilityWpo(rasters).programs.some((p) => p.key === after.key),
    'a program that joined after the open is in no module made from them',
  )
  const extended = graphRastersOf([{ graph: joined }], rasters)
  assert.deepEqual(
    visibilityWpo(extended)
      .programs.map((p) => p.key)
      .sort(),
    [known.key, after.key].sort(),
    'held with the programs that joined, once the session says so',
  )
  assert.equal(
    graphRastersOf([{ graph: joined }], extended),
    extended,
    'the same set when none joins',
  )
})

test('a brick of voxels moves rigidly: its surface’s offset at the centre of its box, the same at each corner and in the cells traced through it', () => {
  const program = slides()
  const rasters = graphRastersOf([{ graph: held.get(program.key) }])
  const asked: { vertex: number; local: number[] }[] = []
  const run = shaderRun<{
    carryOf: (page: object, brick: number) => { m: number[] }
    offsetOf: (page: object, vertex: number) => number[]
  }>(
    `${visVoxelShader(undefined, voxelWpo(rasters))}
fn carryOf(page:PageInfo,brick:u32)->mat4x4f{return voxelCarry(page,brick);}
fn offsetOf(page:PageInfo,vertex:u32)->vec3f{return pageOffset(page,pageHeader(page),vertex,vec3f(0.0),0u,false,WPO_STILL);}`,
    ['carryOf', 'offsetOf'],
    {
      // A brick's box spans four cells along x from its brick number.
      voxelBoxCorner: (_base: number, vertex: number) => [
        Math.floor(vertex / 8) * 4 + ((vertex % 8) % 2 ? 4 : 0),
        0,
        0,
      ],
      pageHeader: () => ({}),
      pageWpoLocal: (_page: unknown, _h: unknown, vertex: number, local: number[]) => {
        asked.push({ vertex, local: [...local] })
        return [0.5, 0, 0]
      },
    },
  )
  const page = { flags: FLAG_VOXEL, wpo: WPO_ROW_MOVES, deformOutput: 0, pageOffset: 0 }
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  // The offset is asked once at the centre of the box of the brick: corner 0 and corner 7 average.
  for (let corner = 0; corner < 8; corner++)
    assert.deepEqual(run.offsetOf(page, 8 + corner), [0.5, 0, 0], `corner ${corner}`)
  assert.ok(
    asked.every((a) => a.vertex === 8 && a.local[0] === 6),
    'at the box centre of brick 1',
  )
  // The cells the box is traced through are carried by the same offset.
  assert.deepEqual(run.carryOf(page, 1).m, identity.slice(0, 12).concat([0.5, 0, 0, 1]))
  assert.deepEqual(run.carryOf({ ...page, wpo: 0 }, 1).m, identity, 'a row that moves nothing')
})
