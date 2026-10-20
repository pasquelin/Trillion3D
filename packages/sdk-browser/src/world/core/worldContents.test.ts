import test from 'node:test'
import assert from 'node:assert/strict'
import { geometry } from '../../../../sdk-core/src/world/geometry/index.ts'
import { material } from '../../../../sdk-core/src/world/material/index.ts'
import { object } from '../../../../sdk-core/src/world/object/index.ts'
import type { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts'
import '../../wasm/sdkWasm.fixture.ts'
import { createWorldNotices } from '../diagnostic/worldNotices.ts'
import type { Batch } from './worldBatches.ts'
import { createWorldContents } from './worldContents.ts'
import type { Cut } from './worldCuts.ts'
import type { ModelSession } from './worldModelJoin.ts'

// A page that rebuilds its geometries once a frame (`shapes-cut-and-extruded`) reads a mesh again
// before its previous read is seated: that read's resource is released by the new one — its
// pages' addresses revoked —, and a frame that seats the meshes while another mesh of the new read
// is still read must not hand it to the session, whose reads of its pages would fail for ever. The
// mesh whose read landed joins on its new resource at once: it never waits for the slowest read.
test('a mesh read again is never seated on the resource its previous read found', async () => {
  const scene = object.group()
  const shaded = material.meshStandard()
  const first = object.mesh(geometry.box(1, 1, 1), shaded),
    second = object.mesh(geometry.sphere(1, 8, 6), shaded)
  scene.add(first, second)
  const contents = createWorldContents(scene, createWorldNotices())
  const handed: Cut[] = []
  const session: ModelSession = {
    growsInPlace: () => true,
    growPlacements() {},
    addPlacements: async (source) => void handed.push((source as Batch).cut),
  }
  contents.changed(scene)
  await contents.resolve()
  contents.seat(session)
  // A rebuild resolved, not seated yet.
  first.geometry = geometry.box(2, 1, 1)
  contents.stale(first)
  await contents.resolve()
  // The next rebuild: the first mesh's read lands, the second's waits, and a frame seats meanwhile.
  let firstRead = () => {},
    secondRead = () => {}
  const firstLanded = new Promise<void>((resolve) => (firstRead = resolve))
  const secondLands = new Promise<void>((resolve) => (secondRead = resolve))
  const read = contents.cuts.of
  contents.cuts.of = async (mesh: Mesh) => {
    const cut = await read(mesh)
    if (mesh === first) firstRead()
    else await secondLands
    return cut
  }
  first.geometry = geometry.box(3, 1, 1)
  second.geometry = geometry.sphere(2, 8, 6)
  contents.stale(first)
  contents.stale(second)
  let landings = 0
  const resolving = contents.resolve(() => landings++)
  await firstLanded
  await Promise.resolve() // the landing runs right behind the read
  const opened = handed.length
  contents.seat(session)
  assert.equal(landings, 1)
  assert.equal(handed.length, opened + 1, 'the mesh read first joins without waiting for the other')
  secondRead()
  await resolving
  contents.seat(session)
  assert.equal(handed.length, opened + 2, 'each mesh joins on what its last read found')
  for (const cut of handed.slice(opened)) assert.ok(cut.users.size > 0, 'each one is worn')
  assert.deepEqual(
    handed.slice(opened).map((cut) => [...cut.users]),
    [[first], [second]],
  )
  contents.cuts.dispose()
})
