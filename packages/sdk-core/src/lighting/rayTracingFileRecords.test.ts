// The ray tracing file's records: the flag of a mesh translucent whole, and the world's records, the actors' and the directory of them.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  RAY_TRACING_FLAG_ACTOR,
  RAY_TRACING_FLAG_ALL_TRANSLUCENT,
  RAY_TRACING_FLAG_TRANSLUCENT,
  RAY_TRACING_FLAG_TWO_SIDED,
  RAY_TRACING_FLAG_WORLD,
  RAY_TRACING_HEAD_BYTES,
  RAY_TRACING_NODE_BYTES,
  RAY_TRACING_NO_PRIMITIVE,
  RAY_TRACING_RECORD_AT,
  RAY_TRACING_RECORD_BYTES,
  RAY_TRACING_TRIANGLE_AT,
  RAY_TRACING_TRIANGLE_BYTES,
} from '../contracts/rayTracingAbi.ts'
import { parseRayTracing } from './rayTracingFile.ts'
import { fileOf, twoRecords } from './rayTracingFile.fixture.ts'

test('a record is flagged translucent whole when it and every primitive of its mesh are translucent', () => {
  const R = RAY_TRACING_RECORD_AT
  const [translucent, whole] = [
    RAY_TRACING_FLAG_TRANSLUCENT,
    RAY_TRACING_FLAG_TRANSLUCENT | RAY_TRACING_FLAG_ALL_TRANSLUCENT,
  ]
  // Mesh 5's primitives 3 and 4, the flags of each.
  const meshOf = (first: number, second: number) =>
    twoRecords(
      (view, at) => {
        view.setUint32(at + R.primitive * 4, 4, true)
        view.setUint32(at + R.flags * 4, second, true)
      },
      (view, at) => view.setUint32(at + R.flags * 4, first, true),
    )
  // All translucent: each flagged; one opaque: none is, the translucent one only translucent.
  assert.equal(parseRayTracing(meshOf(whole, whole)).records[R.flags], whole)
  assert.equal(parseRayTracing(meshOf(translucent, 0)).records[R.flags], translucent)
  assert.throws(
    () => parseRayTracing(meshOf(translucent, translucent)),
    /not flagged translucent whole/,
  )
  assert.throws(() => parseRayTracing(meshOf(whole, 0)), /is flagged translucent whole/)
  assert.throws(() => parseRayTracing(meshOf(whole, translucent)), /not flagged translucent whole/)
  // Translucent whole is a kind of translucent.
  assert.throws(
    () => parseRayTracing(meshOf(RAY_TRACING_FLAG_ALL_TRANSLUCENT, 0)),
    /translucent whole and not translucent/,
  )
  // An actor is a mesh of one material: translucent, it is whole.
  const actor = (flags: number) => (view: DataView, at: number) => {
    view.setUint32(at + R.mesh * 4, RAY_TRACING_NO_PRIMITIVE, true)
    view.setUint32(at + R.primitive * 4, RAY_TRACING_NO_PRIMITIVE, true)
    view.setUint32(at + R.flags * 4, RAY_TRACING_FLAG_ACTOR | flags, true)
  }
  const directory = (view: DataView, at: number) => {
    actor(0)(view, at)
    view.setUint32(at + R.flags * 4, RAY_TRACING_FLAG_WORLD, true)
  }
  // The directory's one entry is the second triangle of the file: it names the actor, whose cell is 9.
  const worldOf = (flags: number) => {
    const bytes = twoRecords(directory, (view, at) => {
      actor(flags)(view, at)
      view.setUint32(at + R.cell * 4, 9, true)
    })
    const view = new DataView(bytes.buffer)
    const entry =
      RAY_TRACING_HEAD_BYTES +
      2 * RAY_TRACING_RECORD_BYTES +
      RAY_TRACING_NODE_BYTES +
      RAY_TRACING_TRIANGLE_BYTES
    view.setUint32(entry + RAY_TRACING_TRIANGLE_AT.cluster * 4, 0, true)
    view.setUint32(entry + RAY_TRACING_TRIANGLE_AT.tag * 4, 9, true)
    return bytes
  }
  assert.equal(parseRayTracing(worldOf(whole)).world, 1)
  assert.throws(
    () => parseRayTracing(worldOf(translucent)),
    /translucent and not flagged translucent whole/,
  )
})

test('the world’s records name no primitive: the actors’, then the directory, which names how many precede it', () => {
  const R = RAY_TRACING_RECORD_AT
  const wears =
    (flags: number, cell = 0) =>
    (view: DataView, at: number) => {
      view.setUint32(at + R.mesh * 4, RAY_TRACING_NO_PRIMITIVE, true)
      view.setUint32(at + R.primitive * 4, RAY_TRACING_NO_PRIMITIVE, true)
      view.setUint32(at + R.flags * 4, flags, true)
      view.setUint32(at + R.cell * 4, cell, true)
    }
  // An actor of cell 9, then the directory of one entry naming the actor of rank `named` and the
  // cell `shown`: the entry is the second triangle of the file of `twoRecords`.
  const worldOf = ({ named = 0, shown = 9 } = {}) => {
    const bytes = twoRecords(
      wears(RAY_TRACING_FLAG_WORLD),
      wears(RAY_TRACING_FLAG_ACTOR | RAY_TRACING_FLAG_TWO_SIDED, 9),
    )
    const view = new DataView(bytes.buffer)
    const at = RAY_TRACING_HEAD_BYTES + 2 * RAY_TRACING_RECORD_BYTES + RAY_TRACING_NODE_BYTES
    view.setUint32(
      at + RAY_TRACING_TRIANGLE_BYTES + RAY_TRACING_TRIANGLE_AT.cluster * 4,
      named,
      true,
    )
    view.setUint32(at + RAY_TRACING_TRIANGLE_BYTES + RAY_TRACING_TRIANGLE_AT.tag * 4, shown, true)
    return bytes
  }
  const file = parseRayTracing(worldOf())
  assert.equal(file.world, 1)
  assert.equal(file.byPrimitive.size, 0, 'the world is no primitive')
  assert.equal(file.records[R.cell], 9)
  assert.equal(file.actorCells, 10, 'one past the largest cell the directory names')
  assert.deepEqual(
    [parseRayTracing(fileOf()).world, parseRayTracing(fileOf()).actorCells],
    [undefined, 0],
  )
  const refused = (
    second: (v: DataView, at: number) => void,
    first?: (v: DataView, at: number) => void,
  ) => assert.throws(() => parseRayTracing(twoRecords(second, first)))
  // A record of the world naming a primitive, one both an actor's and the directory's, a directory with
  // no actor before it, an actor with no directory.
  refused(wears(RAY_TRACING_FLAG_WORLD), (v, at) => {
    wears(RAY_TRACING_FLAG_ACTOR)(v, at)
    v.setUint32(at + R.mesh * 4, 5, true)
  })
  refused(wears(RAY_TRACING_FLAG_WORLD | RAY_TRACING_FLAG_ACTOR), wears(RAY_TRACING_FLAG_ACTOR))
  refused(wears(RAY_TRACING_FLAG_WORLD))
  refused(wears(RAY_TRACING_FLAG_ACTOR), wears(RAY_TRACING_FLAG_ACTOR))
  // The directory has the world's flag and no other, and a record that is no actor's names no cell.
  const alone = (second: (v: DataView, at: number) => void, why: RegExp) =>
    assert.throws(() => parseRayTracing(twoRecords(second, wears(RAY_TRACING_FLAG_ACTOR, 9))), why)
  alone(wears(RAY_TRACING_FLAG_WORLD | RAY_TRACING_FLAG_TWO_SIDED), /not the world's alone/)
  alone(wears(RAY_TRACING_FLAG_WORLD, 9), /names an HLOD cell and is no actor's/)
  assert.throws(
    () => parseRayTracing(twoRecords((view, at) => view.setUint32(at + R.cell * 4, 3, true))),
    /names an HLOD cell and is no actor's/,
  )
  // An entry naming an actor the file has not, or a cell its actor does not show.
  assert.throws(() => parseRayTracing(worldOf({ named: 1 })), /names the actor 1 of 1/)
  assert.throws(() => parseRayTracing(worldOf({ shown: 8 })), /names the cell 8, not its actor's/)
})

test('an actor’s number is the rank of the material it wears, which the file counts; the directory names no primitive', () => {
  const R = RAY_TRACING_RECORD_AT
  const wears =
    (flags: number, primitive: number, cell = 0) =>
    (view: DataView, at: number) => {
      view.setUint32(at + R.mesh * 4, RAY_TRACING_NO_PRIMITIVE, true)
      view.setUint32(at + R.primitive * 4, primitive, true)
      view.setUint32(at + R.flags * 4, flags, true)
      view.setUint32(at + R.cell * 4, cell, true)
    }
  const worldOf = (rank: number, directory = RAY_TRACING_NO_PRIMITIVE) => {
    const bytes = twoRecords(
      wears(RAY_TRACING_FLAG_WORLD, directory),
      wears(RAY_TRACING_FLAG_ACTOR | RAY_TRACING_FLAG_TWO_SIDED, rank, 9),
    )
    const at = RAY_TRACING_HEAD_BYTES + 2 * RAY_TRACING_RECORD_BYTES + RAY_TRACING_NODE_BYTES
    const view = new DataView(bytes.buffer)
    view.setUint32(at + RAY_TRACING_TRIANGLE_BYTES + RAY_TRACING_TRIANGLE_AT.cluster * 4, 0, true)
    view.setUint32(at + RAY_TRACING_TRIANGLE_BYTES + RAY_TRACING_TRIANGLE_AT.tag * 4, 9, true)
    return bytes
  }
  assert.equal(parseRayTracing(worldOf(6)).actorRanks, 7, 'one past the rank it wears')
  assert.equal(parseRayTracing(worldOf(RAY_TRACING_NO_PRIMITIVE)).actorRanks, 0)
  assert.throws(() => parseRayTracing(worldOf(1 << 21)), /wears material/)
  assert.throws(() => parseRayTracing(worldOf(6, 2)), /directory .* names a primitive/)
})
