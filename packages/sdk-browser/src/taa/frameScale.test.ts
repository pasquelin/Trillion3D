import test from 'node:test'
import assert from 'node:assert/strict'
import { DISPLAY, enter, runtime } from './frameScale.fixture.ts'
import { scaleControl } from './frame.fixture.ts'

// A still image is drawn at the controller's scale, the budget's, as a moving one; the
// targets stay made at the bounds' maximum.
test('a moving, a quiet and a convergence image draw at the controller', () => {
  const { rt, moving } = runtime()
  assert.ok(moving < 1)
  enter(rt, false)
  assert.equal(scaleControl(rt).drawn, moving)
  assert.ok(rt.gpu.targetSize[0] < DISPLAY[0], 'drawn below the display')
  assert.equal(scaleControl(rt).steered, true, 'the moving image is what the controller measures')
  rt.run.textureConverging = true
  enter(rt, true)
  assert.equal(scaleControl(rt).drawn, moving, 'the convergence is drawn at the controller too')
  assert.equal(scaleControl(rt).steered, false, 'a convergence image is not measured')
  rt.run.textureConverging = false
  enter(rt, true)
  assert.equal(scaleControl(rt).drawn, moving, 'the quiet image is drawn at the controller too')
  assert.equal(scaleControl(rt).steered, true, 'and measured')
  assert.equal(scaleControl(rt).allocated(), 1, "in targets made at the bounds' maximum")
  rt.capture.capturing = true
  enter(rt, false)
  assert.deepEqual(
    [scaleControl(rt).drawn, rt.gpu.targetSize],
    [1, DISPLAY],
    'no accumulation, no scale',
  )
})
