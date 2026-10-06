// #816: the fallback draw paints the colour target; a frame drawn below the display presents a
// display colour of its own, which that draw never writes. That image waits for targets at the
// display's size, the last one shown meanwhile, rather than presenting the previous or a blank
// display colour; once they land the fallback draws it at the display, nothing lost.
import test from 'node:test'
import assert from 'node:assert/strict'
import { encodeDraws } from './encodeDraws.ts'
import { twoPlacesRuntime } from '../twoPlaces.fixture.ts'

test('the fallback draw over targets drawn below the display waits for native ones, then draws', async () => {
  const { rt, dispose } = await twoPlacesRuntime()
  try {
    const device = rt.gpu.device!
    rt.vis.visView = undefined
    assert.ok(encodeDraws(rt, device, rt.run.gate.cam) > 0, 'at the display, the fallback draws')
    const display = { destroy: () => {} } as unknown as GPUTexture
    Object.assign(rt.gpu, { displayTexture: display, targetSize: [16, 16] })
    const shown = rt.run.imageRevision
    assert.equal(encodeDraws(rt, device, rt.run.gate.cam), 0, 'nothing is drawn')
    assert.equal(rt.run.gpuDrawCalls, 0)
    assert.equal(rt.run.imageRevision, shown, 'nothing is presented')
    assert.ok(rt.gpu.targetGrant, 'targets at the display are asked')
    const { gate } = rt.run,
      changed = gate.resourcesChanged.bind(gate)
    let redraws = 0
    gate.resourcesChanged = () => (redraws++, changed())
    await rt.gpu.targetGrant.done
    assert.equal(rt.gpu.targetGrant, undefined, 'granted')
    assert.ok(redraws > 0, 'the frame loop is told to draw again')
    assert.equal(rt.gpu.displayTexture, rt.gpu.colorTexture, 'the display is the colour again')
    assert.ok(encodeDraws(rt, device, rt.run.gate.cam) > 0, 'the image is drawn')
    assert.equal(rt.run.imageRevision, shown + 1)
  } finally {
    dispose()
  }
})
