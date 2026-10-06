import test from 'node:test'
import assert from 'node:assert/strict'
import { TileSchedule } from './tileSchedule.ts'
import { placedOf, type Placed, type TileShape } from './tilePlace.ts'
import { compiledModel, cooked, place, tile } from './tiles.fixture.ts'
import { repeated } from './tileShapes.fixture.ts'

/** A schedule over the placements of `file`'s tiles in a model at the origin, every part of the
 *  session it calls a stand-in: the schedule, the opening, the tiles by URL, the calls of `hold`
 *  and the placements built, evicted and removed; `holds` throws on its `throwAt`-th call. */
function scheduled(file: ReturnType<typeof cooked>) {
  const tiles = new Map<string, TileShape>()
  const calls = { hold: 0, built: [] as Placed[], evicted: 0, removed: 0, throwAt: 0 }
  const hold = (kind: string, url: string, bytes: number, extra: object, holders: number) => {
    calls.hold++
    if (!tiles.has(url))
      tiles.set(url, {
        ...{ kind, url, bytes, handle: -1, users: 0, holders, read: null, abort: null },
        ...{ refused: false, wanted: -1, listed: false, ...extra },
      } as TileShape)
    return tiles.get(url)!
  }
  const model = compiledModel()
  model.updateMatrixWorld(true)
  const opening = { placed: placedOf(model, file as never, { hold } as never) }
  const holds = () => {
    if (--calls.throwAt === 0) throw new Error('refused')
    return false
  }
  const schedule = new TileSchedule({
    bodies: { meshes: [], nested: new Map(), state: { velocity: new Float32Array(0) } } as never,
    declared: { holds } as never,
    shapes: { settle() {}, read: () => new Promise(() => {}) } as never,
    resident: {
      ...{ evict: () => calls.evicted++, remove: () => calls.removed++ },
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
  const counted = [...tiles.values()].map((shape) => shape.counted === shape.seen)
  assert.deepEqual(counted, [true, false, false], 'the nearest tile’s bytes alone')
})

test('a model’s placements of one tile hold its shape once, by their count', () => {
  const { tiles, calls, opening } = scheduled(repeated(1000))
  assert.deepEqual([calls.hold, tiles.size, opening.placed.length], [1, 1, 1000])
  assert.equal([...tiles.values()][0].holders, 1000)
})

test('the placements of a refused tile leave their opening once, every one of them', () => {
  const { tiles, calls, opening, want } = scheduled(repeated(100))
  for (const shape of tiles.values()) shape.refused = true
  want()
  want()
  assert.deepEqual([opening.placed.length, calls.removed], [0, 100])
})

test('an update that throws leaves no placement of it to the next', () => {
  const { schedule, tiles, calls, want } = scheduled(repeated(3))
  for (const shape of tiles.values()) shape.handle = 0
  // It throws at the second placement, the first one listed.
  calls.throwAt = 2
  assert.throws(want)
  want()
  schedule.admit(100, 10)
  schedule.start()
  assert.equal(calls.built.length, 3, 'each placement built once')
})
