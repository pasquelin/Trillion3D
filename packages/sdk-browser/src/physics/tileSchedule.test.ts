import test from 'node:test'
import assert from 'node:assert/strict'
import { CommandWriter } from '../../../sdk-core/src/physics/index.ts'
import { TileSchedule } from './tileSchedule.ts'
import { placedOf, type Placed } from './tilePlace.ts'
import { compiledModel, cooked, modelStreamer, place, sharedShapes, tile } from './tiles.fixture.ts'
import { repeated } from './tileShapes.fixture.ts'

/** The cooked objects of a session (`sharedShapes`), the calls of their `hold` counted, and a
 *  model at the origin. */
function session() {
  const { bodies } = modelStreamer()
  const shapes = sharedShapes(new CommandWriter(), bodies)
  const calls = { hold: 0 }
  const hold = shapes.hold.bind(shapes)
  shapes.hold = (...args) => (calls.hold++, hold(...args))
  const model = compiledModel()
  model.updateMatrixWorld(true)
  return { shapes, calls, model }
}

/** A schedule over the placements of `file`'s tiles in a model at the origin, its bodies, the
 *  bodies the models declare and the resident tiles stand-ins: the schedule, the opening, the
 *  tiles, the calls of `hold` and the placements built and removed; `holds` throws on its
 *  `throwAt`-th call. */
function scheduled(file: ReturnType<typeof cooked>) {
  const { shapes, calls: held, model } = session()
  const calls = Object.assign(held, { built: [] as Placed[], removed: 0, throwAt: 0 })
  const opening = { placed: placedOf(model, file as never, shapes) }
  const tiles = new Set(opening.placed.map((p) => p.shape))
  const holds = () => {
    if (--calls.throwAt === 0) throw new Error('refused')
    return false
  }
  const schedule = new TileSchedule({
    bodies: { meshes: [], nested: new Map(), state: { velocity: new Float32Array(0) } } as never,
    declared: { holds } as never,
    shapes,
    resident: {
      evict() {},
      remove: (p: Placed) => (calls.removed++, (p.left = Infinity)),
      build: (p: Placed) => calls.built.push(p),
    } as never,
    ...{ invalidate() {}, failed() {} },
  })
  const want = () => schedule.want(new Map([[model, opening]]), [0, 0, 0], 100)
  want()
  return { schedule, opening, tiles, calls, want }
}

test('an update counts the bytes of the tiles it gives a body alone', () => {
  const file = cooked([{ kind: 'mesh', tiles: [tile(0), tile(10), tile(20)] }], [place(0)])
  const { schedule, tiles } = scheduled(file)
  // Room for every tile's bytes, one body.
  schedule.admit(100, 1)
  const counted = [...tiles].map((shape) => shape.counted === shape.seen)
  assert.deepEqual(counted, [true, false, false], 'the nearest tile’s bytes alone')
})

test('a model’s placements of one tile hold its shape once, by their count', () => {
  const { tiles, calls, opening } = scheduled(repeated(1000))
  assert.deepEqual([calls.hold, tiles.size, opening.placed.length], [1, 1, 1000])
  assert.equal([...tiles][0].holders, 1000)
})

test('the placements of a refused tile leave their opening once, every one of them', () => {
  const { tiles, calls, opening, want } = scheduled(repeated(100))
  for (const shape of tiles) shape.refused = true
  want()
  want()
  assert.deepEqual([opening.placed.length, calls.removed], [0, 100])
})

test('an update that throws leaves no placement of it to the next', () => {
  const { schedule, tiles, calls, want } = scheduled(repeated(3))
  for (const shape of tiles) shape.handle = 0
  // It throws at the second placement, the first one listed.
  calls.throwAt = 2
  assert.throws(want)
  want()
  schedule.admit(100, 10)
  schedule.start()
  assert.equal(calls.built.length, 3, 'each placement built once')
})

test('a model file that throws as its placements are read holds none of its tiles', () => {
  const { shapes, calls, model } = session()
  // The second placement has no pose.
  const file = cooked([{ kind: 'mesh', tiles: [tile()] }], [place(0), { node: 1, collider: 0 }])
  assert.throws(() => placedOf(model, file as never, shapes))
  const url = 'https://cache.test/model/t0.bin'
  // Nothing held by the file; held anew, by one alone.
  assert.deepEqual([calls.hold, shapes.hold('tile', url, 2, {}).holders], [0, 1])
})
