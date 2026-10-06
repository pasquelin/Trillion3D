// A dynamic sea of 80 000 triangles beside thirty small bodies opened the WebGPU session on a
// geometry pool of 3 811 root pages of 1.78 MB each, 6.8 GB, past any device's buffer: each page of
// the sheet, drawn from the float pool, reserved results for every vertex of the whole sheet. Its
// results now lie once per placement in the float pool (`wholePool.ts`); a page's slot holds its
// own bytes. Built through the engine's own path: the world cuts the scene, the session collects it.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { object } from '../../../sdk-core/src/world/object/index.ts'
import { geometry } from '../../../sdk-core/src/world/geometry/index.ts'
import { material } from '../../../sdk-core/src/world/material/index.ts'
import { collectedPages, dynamicWorld } from '../world/core/worldDynamic.fixture.ts'
import { describePageSlots, pageAddress } from '../webgpu/row/pageSlots.ts'
import { deformationSlotBytes, pooledOutputs } from './slotLayout.ts'
import { rootCoverage } from '../page/selection/selection.ts'
import { rootChildren } from '../residency/minimumCapacity.ts'
import { pageHomes } from '../gpu/page/homes.ts'
import { DEFAULT_GEOMETRY_POOL_BUDGET } from '../residency/pools.ts'
import { sessionGeometryPool } from '../residency/sessionPool.ts'

/** The device of the report: a buffer of at most 4 294 967 292 bytes. */
const DEVICE = { maxBufferSize: 4294967292, maxStorageBufferBindingSize: 4294967292 }

/** The report's scene, its sheet `scale` times as many cells a side: the sea, a 208 m bed, 22
 *  floating bodies and 8 posts, boxes, 24-sided cylinders and 24 × 16 spheres. */
async function scene(scale: number) {
  const world = dynamicWorld()
  const sheet = geometry.plane(200 * scale, 200 * scale, 200 * scale, 200 * scale)
  sheet.usage = 'dynamic'
  const water = material.meshStandard({
    ...{ transparent: true, opacity: 0.8, depthWrite: false, side: 'double' },
    ...{ roughness: 0.06, metalness: 0.1 },
  })
  world.scene.add(object.mesh(sheet, water))
  world.scene.add(object.mesh(geometry.box(208, 1, 208), material.meshStandard()))
  const shapes = [
    geometry.box(1, 1, 1),
    geometry.cylinder(0.5, 0.5, 2, 24),
    geometry.sphere(1, 24, 16),
  ]
  for (let i = 0; i < 30; i++) {
    const body = object.mesh(shapes[i % 3], material.meshStandard())
    body.position.set((i % 6) * 9 - 22, 2, Math.floor(i / 6) * 9 - 18)
    world.scene.add(body)
  }
  await world.frame()
  const { roots, records } = await collectedPages(world.sources[0])
  world.end()
  return { sheet, roots, records }
}

/** The pool the session draws, as `webgpu/pages/prepare/setup.ts` draws it; and on a device whose
 *  buffer holds every page at its own size twice, not the root cover in slots of the widest. */
function poolOf({ roots, records }: Awaited<ReturnType<typeof scene>>) {
  const slots = describePageSlots(records)
  const pageBytes = deformationSlotBytes(records, slots.pageBytes, roots, slots.homes)
  const cover = rootCoverage(roots, pageAddress).map(pageAddress)
  const rootPages = new Set([...cover, ...rootChildren(roots).map(pageAddress)]).size
  const homeBytes = pageHomes(slots.homes)!.bytes,
    small = { maxBufferSize: 2 * homeBytes, maxStorageBufferBindingSize: 2 * homeBytes }
  const uniquePages = Math.max(1, new Set(records.map(pageAddress)).size)
  const poolOn = (limits: typeof DEVICE) =>
    sessionGeometryPool(
      { pageBytes, uniquePages, homeBytes, rootPages, limits },
      undefined,
      undefined,
      true,
    ).pool
  assert.ok(rootPages * pageBytes > small.maxBufferSize, 'the root cover in slots passes it')
  const held = poolOn(small)
  assert.ok(held.slots >= rootPages && held.allocatedBytes === homeBytes, `${held.allocatedBytes}`)
  return { pool: poolOn(DEVICE), pageBytes, sourceBytes: slots.pageBytes, rootPages }
}

// The report's sheet (3 800 root pages), then one four times larger (14 800).
for (const [scale, least] of [
  [1, 3000],
  [2, 12000],
]) {
  test(`a sheet ${scale}× the report's opens on any device that holds its pages, its results once`, async () => {
    const built = await scene(scale)
    const { pool, pageBytes, sourceBytes, rootPages } = poolOf(built)
    assert.ok(rootPages > least, `${rootPages} root pages`)
    // No sheet page widens the slot: none draws from a geometry page, none holds a tail of its own.
    assert.equal(pageBytes, sourceBytes)
    assert.ok(pool.allocatedBytes <= DEFAULT_GEOMETRY_POOL_BUDGET, `${pool.allocatedBytes} bytes`)
    assert.ok(pool.slots >= rootPages)
    // The sheet's results: one block of all its vertices, shared by all its pages.
    const outputs = pooledOutputs(built.records)
    assert.equal(outputs.length, 1)
    assert.equal(outputs[0].count, built.sheet.attributes.position.count)
    const sheetPages = built.records.filter((rec) => rec.deformationOutput)
    assert.ok(sheetPages.every((rec) => rec.deformationOutput === outputs[0]))
  })
}
