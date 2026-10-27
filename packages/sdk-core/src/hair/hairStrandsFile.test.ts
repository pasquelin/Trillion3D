// The hair strands file as the compiler lays it out: a head, a record for each group, then the
// tables of every group one after the other. Two groups, the second carrying every attribute; the
// reader gives each group its views and refuses a file whose ranks or sizes do not close.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  HAIR_STRANDS_ATTRIBUTE_COLOR,
  HAIR_STRANDS_ATTRIBUTE_ROOT_UV,
  HAIR_STRANDS_ATTRIBUTE_ROUGHNESS,
  HAIR_STRANDS_GROUP_AT,
  HAIR_STRANDS_GROUP_BYTES,
  HAIR_STRANDS_HEAD_BYTES,
  HAIR_STRANDS_MAX_POINTS_PER_GROUP,
  HAIR_STRANDS_POINT_BYTES,
  HAIR_STRANDS_VERSION,
} from '../contracts/hairStrandsAbi.ts'
import { fromHalf } from '../../../math/src/float/half.ts'
import { assertHairStrandsSection, parseHairStrands } from './hairStrandsFile.ts'
import { hairStrandsFixture, type FixtureGroup } from './hairStrandsFile.fixture.ts'

const FIRST: FixtureGroup = {
  id: 0,
  curves: [
    [0, 0, 0, 1, 0, 0, 2, 0, 0],
    [0, 1, 0, 0, 2, 0],
    [4, 4, 4, 5, 5, 5, 6, 4, 6, 7, 7, 7],
  ],
}
const SECOND: FixtureGroup = {
  id: 7,
  curves: [
    [-1, -1, -1, 1, 1, 1],
    [0, 0, 0, 0, 1, 0, 0, 2, 0],
  ],
  rootUvs: [0x11, 0x22],
  colors: [1, 2, 3, 4, 5],
  roughness: [9, 8, 7, 6, 5],
}

test('each group of the file gets its counts, its box and its tables', () => {
  const { groups } = parseHairStrands(hairStrandsFixture([FIRST, SECOND]))
  assert.equal(groups.length, 2)
  const [a, b] = groups
  assert.deepEqual([a!.groupId, a!.curveCount, a!.pointCount], [0, 3, 9])
  assert.deepEqual([b!.groupId, b!.curveCount, b!.pointCount], [7, 2, 5])
  assert.deepEqual([...a!.boundsMin], [0, 0, 0])
  assert.deepEqual([...a!.boundsMax], [7, 7, 7])
  assert.equal(a!.points.length, 9 * HAIR_STRANDS_POINT_BYTES)
  assert.equal(a!.rootUvs, undefined)
  assert.equal(a!.colors, undefined)
  assert.equal(
    b!.attributes,
    HAIR_STRANDS_ATTRIBUTE_ROOT_UV |
      HAIR_STRANDS_ATTRIBUTE_COLOR |
      HAIR_STRANDS_ATTRIBUTE_ROUGHNESS,
  )
  assert.deepEqual([...new Uint32Array(b!.rootUvs!.slice().buffer)], [0x11, 0x22])
  assert.deepEqual([...new Uint32Array(b!.colors!.slice().buffer)], [1, 2, 3, 4, 5])
  assert.deepEqual([...b!.roughness!], [9, 8, 7, 6, 5])
  assert.deepEqual([...a!.seeds], [0, 1, 2])
  assert.deepEqual([...b!.seeds], [0, 1])
})

test('a point is its position relative to the centre of the box, in half floats', () => {
  const [a] = parseHairStrands(hairStrandsFixture([FIRST])).groups
  const view = new DataView(a!.points.buffer, a!.points.byteOffset, a!.points.byteLength)
  // The box is 0 to 7 on each axis: the centre is 3.5, the last point (7, 7, 7) lies 3.5 from it.
  const last = 8 * HAIR_STRANDS_POINT_BYTES
  for (let axis = 0; axis < 3; axis++) {
    assert.equal(fromHalf(view.getUint16(last + axis * 2, true)), 3.5)
    assert.equal(fromHalf(view.getUint16(axis * 2, true)), -3.5)
  }
})

test('the file is refused when its size, its ranks or its curves do not close', () => {
  const good = hairStrandsFixture([FIRST, SECOND])
  const refused = (bytes: Uint8Array<ArrayBuffer>, why: RegExp) =>
    assert.throws(() => parseHairStrands(bytes), why)
  refused(good.subarray(0, good.length - 4), /not its head, its records and its tables/)
  refused(good.subarray(0, HAIR_STRANDS_HEAD_BYTES + 4), /shorter than its records/)
  const edited = (change: (view: DataView, second: number) => void) => {
    const bytes = good.slice()
    change(new DataView(bytes.buffer), HAIR_STRANDS_HEAD_BYTES + HAIR_STRANDS_GROUP_BYTES)
    return bytes
  }
  refused(
    edited((view, second) =>
      view.setUint32(second + HAIR_STRANDS_GROUP_AT.firstCurve * 4, 9, true),
    ),
    /out of the order/,
  )
  refused(
    edited((view, second) =>
      view.setUint32(second + HAIR_STRANDS_GROUP_AT.flags * 4, 0x8000, true),
    ),
    /flags/,
  )
  refused(
    edited((view, second) =>
      view.setUint32(
        second + HAIR_STRANDS_GROUP_AT.pointCount * 4,
        HAIR_STRANDS_MAX_POINTS_PER_GROUP + 1,
        true,
      ),
    ),
    /points/,
  )
  refused(
    edited((view) => view.setUint32(8, 1000, true)),
    /shorter than its records/,
  )
  const gap = good.slice()
  // The second curve of the first group starts one point late.
  const curvesAt = HAIR_STRANDS_HEAD_BYTES + 2 * HAIR_STRANDS_GROUP_BYTES
  new DataView(gap.buffer).setUint32(curvesAt + 4, 4 | (2 << 24), true)
  refused(gap, /one after the other/)
})

test('a section of another version is refused by its version, one without a file by its file', () => {
  assert.equal(assertHairStrandsSection(undefined), undefined)
  const section = { version: HAIR_STRANDS_VERSION, file: 'hairStrands.bin', bytes: 10 }
  assert.deepEqual(assertHairStrandsSection(section), section)
  assert.throws(() => assertHairStrandsSection({ ...section, version: 99 }), /version 99/)
  assert.throws(() => assertHairStrandsSection({ version: HAIR_STRANDS_VERSION }), /names no file/)
})
