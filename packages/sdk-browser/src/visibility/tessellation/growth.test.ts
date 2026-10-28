// The capacity of the tessellation grows on a loss read back, doubled, as far as the device allows; nothing grows without one.
import test from 'node:test'
import assert from 'node:assert/strict'
import { rasterOf } from '../raster/rasterFrame.fixture.ts'
import { growCapacity, withGrowth } from './growth.ts'

/** What the session grew to on `device`, read as the next image asks it. */
const grownCapacity = (device: GPUDevice) => {
  const asked = withGrowth(device, { candidate: 0, visible: 0, records: 0 })
  return asked.candidate || asked.visible
    ? { candidate: asked.candidate, visible: asked.visible }
    : undefined
}

const NONE = { queue: 0, visible: 0, windows: 0, occluded: 0 }
const ask = { candidate: 1000, visible: 1000, records: 192 }

test('a loss read doubles what the next image asks for, the groups made again with the instance; no loss, no growth', () => {
  const { device, raster } = rasterOf(true)
  raster.followTessellation(device, { ...ask })
  const first = raster.tessellation!
  assert.equal(
    growCapacity(device, first.shadow.resources, NONE),
    false,
    'nothing lost: nothing grown',
  )
  assert.equal(grownCapacity(device), undefined)
  assert.equal(growCapacity(device, first.shadow.resources, { ...NONE, queue: 3 }), true)
  assert.deepEqual(
    grownCapacity(device),
    { candidate: 2000, visible: 1000 },
    'the queue, and what follows its size, doubled; the visible list not',
  )
  // The next image asks the settings' floor raised to it: the instance is made again, its buffers and groups with it.
  const made = () => raster.tessellation
  raster.followTessellation(device, withGrowth(device, { ...ask }))
  assert.notEqual(made(), first, 'made again for the larger capacity')
  assert.deepEqual([made()!.asked.candidate, made()!.asked.visible], [2000, 1000])
  assert.notEqual(
    made()!.shadow.resources,
    first.shadow.resources,
    'its buffers and the groups over them are new',
  )
  // The same ask again keeps it.
  const second = made()
  raster.followTessellation(device, withGrowth(device, { ...ask }))
  assert.equal(made(), second)
})

test('the windows and the occlusion’s buffer follow the queue; the visible list grows on its own loss', () => {
  const { device, raster } = rasterOf(true)
  raster.followTessellation(device, { ...ask })
  const resources = raster.tessellation!.shadow.resources
  assert.equal(growCapacity(device, resources, { ...NONE, windows: 1 }), true)
  assert.equal(
    grownCapacity(device)!.candidate,
    2000,
    'a window lost grows the queue it is a share of',
  )
  assert.equal(grownCapacity(device)!.visible, 1000)
  assert.equal(growCapacity(device, resources, { ...NONE, visible: 1 }), true)
  assert.deepEqual(grownCapacity(device), { candidate: 2000, visible: 2000 })
  assert.equal(growCapacity(device, resources, { ...NONE, occluded: 1 }), true)
  assert.equal(
    grownCapacity(device)!.candidate,
    2000,
    'doubled from the instance read: the next instance reads the next loss',
  )
})

test('the growth stops where the device cannot hold more', () => {
  const { device } = rasterOf(true)
  const resources = {
    capacity: { candidate: 1000, visible: 1000, records: 192 },
    // The device holds what it holds already.
    roomFor: () => ({ candidate: 1000, visible: 1000, records: 192 }),
  }
  assert.equal(growCapacity(device, resources, { ...NONE, queue: 5, visible: 5 }), false)
  assert.equal(grownCapacity(device), undefined)
})
