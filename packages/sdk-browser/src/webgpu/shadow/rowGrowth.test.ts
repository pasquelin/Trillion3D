// The shadow pass's buffers sized by row — the spheres, the mobility words, the row detail — have
// one resize, the table's growth (`growShadowRows`): made aside, put in place at the commit, the old
// ones retired after the frame's submit, never destroyed while the image's commands may name them.
// Their first making never resizes: a held buffer is the one the growth keeps.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { pendingAll } from '../../gpu/core/tableGrowth.ts'
import { destroyRetired } from '../../gpu/core/frameRetire.ts'
import { clusterSpheres, growShadowRows, mobilityRows, rowLodBuffer } from './rowBuffers.ts'
import { ensureRowLods } from './rowLods.ts'
import { ensureClusterSpheres } from './spheres.ts'
import type { WebgpuLightState } from '../pages/state/lights.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'

test('the row detail grows with the spheres and the mobility words, retired after the submit', () => {
  const { device, destroyed } = fakeDevice()
  const lights = {
    spheres: clusterSpheres(device, 4),
    mobilityRows: mobilityRows(device, 4),
    rowLods: rowLodBuffer(device, 4),
    changes: { worldChanged: () => undefined },
  } as unknown as WebgpuLightState
  const held = [lights.spheres!.buffer, lights.mobilityRows!, lights.rowLods!.buffer]
  const growth = pendingAll(growShadowRows(lights, device, 9))
  assert.equal(lights.rowLods!.rows, 4, 'nothing in place before the commit')
  growth.commit()
  assert.deepEqual([lights.spheres!.rows, lights.rowLods!.rows], [9, 9])
  assert.equal(lights.rowLods!.buffer.size, rowLodBuffer(device, 9).buffer.size)
  assert.equal(held.filter((buffer) => destroyed.includes(buffer)).length, 0, 'none destroyed yet')
  destroyRetired(device)
  assert.equal(held.filter((buffer) => destroyed.includes(buffer)).length, 3, 'all three retired')
})

test('a held row buffer is never remade by its first making', () => {
  const { device, destroyed } = fakeDevice()
  const lights = {
    spheres: clusterSpheres(device, 4),
    rowLods: rowLodBuffer(device, 4),
    casts: {},
    changes: { worldChanged: () => undefined },
  }
  const rt = { lights, layout: { rows: { casterSlots: 9 } } } as unknown as WebgpuPagesRuntime
  const [spheres, rowLods] = [lights.spheres, lights.rowLods]
  ensureClusterSpheres(rt, device)
  ensureRowLods(rt, device)
  assert.equal(lights.spheres, spheres)
  assert.equal(lights.rowLods, rowLods)
  assert.equal(destroyed.length, 0)
})
