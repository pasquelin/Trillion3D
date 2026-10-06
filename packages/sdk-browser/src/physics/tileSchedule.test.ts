import test from 'node:test'
import assert from 'node:assert/strict'
import type { CookedTile } from '../../../sdk-core/src/physics/index.ts'
import { TileSchedule } from './tileSchedule.ts'
import { placedOf, type Placed, type TileShape } from './tilePlace.ts'
import { compiledModel, cooked, place, tile } from './tiles.fixture.ts'

/** A schedule over the placements of `file`'s tiles in a model at the origin, every part of the
 *  session it calls a stand-in: the schedule, the placements, and the tiles by URL. */
function scheduled(file: ReturnType<typeof cooked>) {
  const tiles = new Map<string, TileShape>()
  const hold = (kind: string, url: string, bytes: number, extra: { tile: CookedTile }) => {
    if (!tiles.has(url))
      tiles.set(url, {
        ...{ kind, url, bytes, handle: -1, users: 0, holders: 1, read: null, abort: null },
        ...{ refused: null, wanted: -1, listed: false, ...extra },
      } as TileShape)
    return tiles.get(url)!
  }
  const model = compiledModel()
  model.updateMatrixWorld(true)
  const placed = placedOf(model, file as never, { hold } as never)
  const schedule = new TileSchedule({
    bodies: { meshes: [], nested: new Map(), state: { velocity: new Float32Array(0) } } as never,
    declared: { holds: () => false } as never,
    shapes: { settle() {}, read: () => new Promise(() => {}) } as never,
    resident: { evict: (_: Placed) => {}, build() {} } as never,
    ...{ invalidate() {}, failed() {} },
  })
  schedule.want(new Map([[model, { placed }]]), [0, 0, 0], 100)
  return { schedule, placed, tiles }
}

test('an update counts the bytes of the tiles it gives a body alone', () => {
  const file = cooked([{ kind: 'mesh', tiles: [tile(0), tile(10), tile(20)] }], [place(0)])
  const { schedule, tiles } = scheduled(file)
  // Room for every tile's bytes, one body.
  schedule.admit(100, 1)
  const counted = [...tiles.values()].map((shape) => shape.counted === shape.seen)
  assert.deepEqual(counted, [true, false, false], 'the nearest tile’s bytes alone')
})
