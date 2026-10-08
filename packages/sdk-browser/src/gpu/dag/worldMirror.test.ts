// The world DAG's residency mirrors the scene's: packed beside the manifest primitives, its
// super-roots are rows like any page, its object clusters resident while their placed object's
// root cover is. Across a cell's arrival and departure the cut, on the CPU oracle, covers every
// leaf exactly once: no hole, no double draw.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorldResidencyMirror } from './worldMirror.ts'
import { packDagSelection } from './pack.ts'
import { createDagResources } from './resources.ts'
import { createDagRuntime } from './runtime.ts'
import { ruleDag, coverFault } from '../../page/cut/cutRule.fixture.ts'
import { coverAt, worldDag } from '../../scene/worldSuperRoots.fixture.ts'
import { SHADOW_LIMITS } from '../../webgpu/pages/testScenes.fixture.ts'
import { fakeDevice, written } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { followWorldLinks } from './worldFollow.ts'
import { stepsOnly } from './stepsOnly.fixture.ts'
import { cameraSelectionUniforms } from '../core/selection.ts'
import { oracleBackend, stripCamera } from '../../page/cut/cutRuleBackends.fixture.ts'

const THRESHOLD = 0.1,
  OBJECTS = 12

/** Twelve placements of one manifest primitive, object `o` on placement `o`, then the world DAG
 *  of three cells of four objects (`worldRootsDag`), packed last; its super-roots all held. */
function scene() {
  const world = worldDag(),
    manifest = ruleDag(8)
  const packed = packDagSelection([...Array.from({ length: OBJECTS }, () => manifest), world])
  const mirror = createWorldResidencyMirror({ ...packed, world: packed.world! })
  const rows = new Uint32Array(packed.pageCount)
  const { pageBase } = packed.cutLinks[OBJECTS]
  // Every super-root held: their rows say so.
  world.origins.forEach((origin, rank) => origin < 0 && (rows[pageBase + rank] = 1))
  /** The world DAG's slice of the mirror, as the oracle reads it. */
  const worldResidency = () => Uint8Array.from(mirror.flags.subarray(pageBase))
  /** Placement `w`'s root cover resident, or not, in the rows' flags. */
  const cover = (w: number, resident: boolean) => {
    const { pageBase: base, structure } = packed.cutLinks[w]
    for (const root of structure!.roots) rows[base + root] = resident ? 1 : 0
  }
  /** Placement `w` places `object` (an `origin`), or none (`-1`), as `placeObject` says it. */
  const link = (w: number, object: number) => {
    const placed = packed.world!
    placed.links[w] = placed.linkOf(object)
    placed.linksMoved?.(Int32Array.of(w), 1)
  }
  return { world, packed, mirror, rows, pageBase, worldResidency, cover, link }
}

test('the cut that packs the world DAG mirrors the rows; one without it reads them', async () => {
  const { packed, mirror, rows } = scene()
  const cutOf = async (dag: typeof packed) =>
    createDagRuntime((await createDagResources(fakeDevice({ limits: SHADOW_LIMITS }).device, dag))!)
  // The rows name every page; its mirror sets the object clusters.
  const selection = await cutOf(packed)
  assert.deepEqual([packed.world!.root, selection.packsWorld], [OBJECTS, true])
  assert.equal(mirror.update(rows).flags.length, packed.pageCount)
  // Its tables are host bytes the CPU budget holds, counted in the cut's own.
  assert.ok(mirror.hostBytes >= mirror.flags.byteLength)
  assert.ok(selection.hostBytes >= mirror.hostBytes, 'the cut counts its mirror')
  assert.doesNotThrow(() => selection.updateResidency(rows))
  assert.throws(
    () => selection.updateResidency(rows.subarray(1)),
    /GPU_SELECTION_RESIDENCY_COUNT_CHANGED/,
  )
  // A cut without the world DAG: the rows go up as they are.
  const scenePacked = packDagSelection(Array.from({ length: OBJECTS }, () => ruleDag(8)))
  const plain = await cutOf(scenePacked)
  assert.deepEqual([scenePacked.world, plain.packsWorld], [undefined, false])
  assert.doesNotThrow(() => plain.updateResidency(rows.subarray(0, scenePacked.pageCount)))
})

test('an object cluster is resident only while its object is placed and its cover resident', () => {
  const { mirror, rows, pageBase, cover, link } = scene()
  link(3, 3)
  mirror.update(rows)
  assert.equal(mirror.flags[pageBase + 3], 0, 'placed, its cover not yet read')
  cover(3, true)
  const { changes } = mirror.update(rows)
  assert.equal(mirror.flags[pageBase + 3], 1, 'placed and drawable')
  // Only what moved is handed over, sorted: the cover's pages, then the object root.
  const moved = [...changes.pages.subarray(0, changes.count)]
  assert.deepEqual(
    moved,
    [...moved].sort((a, b) => a - b),
  )
  assert.ok(moved.includes(pageBase + 3))
  link(3, -1)
  mirror.update(rows)
  assert.equal(mirror.flags[pageBase + 3], 0, 'its object left: the super-root stands in')
  assert.equal(mirror.update(rows).changes.count, 0, 'nothing moved, nothing handed over')
})

test('a cell coming near and going far is covered exactly once at every step', () => {
  const { world, mirror, rows, worldResidency, cover, link } = scene()
  const cut = oracleBackend(world, THRESHOLD)
  /** Cells 0 and 1 near (their objects placed, covers resident), cell 2 far. */
  for (let o = 0; o < 8; o++) {
    link(o, o)
    cover(o, true)
  }
  const steps: [string, () => void][] = [
    ['cells 0 and 1 near, cell 2 far', () => {}],
    [
      'cell 2 placed, its covers not read yet',
      () => {
        for (let o = 8; o < 12; o++) link(o, o)
      },
    ],
    [
      'cell 2 drawable',
      () => {
        for (let o = 8; o < 12; o++) cover(o, true)
      },
    ],
    [
      'cell 0 gone far',
      () => {
        for (let o = 0; o < 4; o++) link(o, -1)
      },
    ],
  ]
  const expected = [
    [0, 1, 2, 3, 4, 5, 6, 7, 14, 14, 14, 14],
    [0, 1, 2, 3, 4, 5, 6, 7, 14, 14, 14, 14],
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    [12, 12, 12, 12, 4, 5, 6, 7, 8, 9, 10, 11],
  ]
  steps.forEach(([name, step], at) => {
    step()
    mirror.update(rows)
    const { drawn } = cut(worldResidency())
    assert.equal(coverFault(world, drawn), -1, `${name}: a leaf is not covered exactly once`)
    const units = Array.from({ length: OBJECTS }, (_, unit) => coverAt(world, drawn, unit))
    assert.deepEqual(units, expected[at], name)
  })
})

test('a placement that gives its object back turns it out before the next cut, no row moving', async () => {
  const { packed, rows, pageBase, cover } = scene()
  const host = fakeDevice({ limits: SHADOW_LIMITS }),
    resources = (await createDagResources(host.device, packed))!
  // The cut itself is the GPU's: here only what the follower hands it before encoding counts.
  const runtime = stepsOnly(createDagRuntime(resources))
  const selection = followWorldLinks(runtime, resources)
  // Cell 1's four objects placed and drawable: their world group is ready.
  for (let o = 4; o < 8; o++) {
    selection.placeObject!(o, o)
    cover(o, true)
  }
  selection.updateResidency(rows)
  assert.ok(selection.isReady(pageBase + 5), 'placed and drawable')
  // The links that moved go up behind the cold records before the cut, in one write, where the
  // descent's gate reads them.
  const cut = () =>
    selection.dispatch(cameraSelectionUniforms(stripCamera(scene().world), 0.1, [64, 64]))
  const writes = host.writes.length
  const linkOf = (w: number) => {
    const at = ((packed.world!.linkBase + w) * 4) % resources.coldParts.bytes,
      write = host.writes.findLast((x) => x.offset <= at && at < x.offset + written(x).byteLength)!
    const bytes = written(write)
    return new DataView(bytes.buffer, bytes.byteOffset + at - write.offset, 4).getUint32(0, true)
  }
  cut()
  assert.equal(host.writes.length - writes, 1, 'four links, one write')
  assert.equal(linkOf(5), pageBase + 5)
  selection.placeObject!(5, -1)
  selection.placeObject!(7, -1)
  assert.ok(selection.isReady(pageBase + 5), 'not before the cut')
  const moved = host.writes.length
  cut()
  assert.ok(!selection.isReady(pageBase + 5), 'its group stands in from this cut on')
  assert.equal(linkOf(5), 0xffffffff)
  assert.equal(linkOf(7), 0xffffffff)
  // Two links a word apart go up in one write of the three words, not one each.
  const at = ((packed.world!.linkBase + 5) * 4) % resources.coldParts.bytes
  const linked = host.writes.slice(moved).filter((write) => write.offset === at)
  assert.deepEqual(
    linked.map((write) => written(write).byteLength),
    [12],
  )
  // Two links within the run writer's gap go up in one write too (`split.ts`).
  const before = host.writes.length
  selection.placeObject!(0, 0)
  selection.placeObject!(11, 11)
  cut()
  const first = ((packed.world!.linkBase + 0) * 4) % resources.coldParts.bytes
  const joined = host.writes.slice(before).filter((write) => write.offset === first)
  assert.deepEqual(
    joined.map((write) => written(write).byteLength),
    [48],
  )
})
