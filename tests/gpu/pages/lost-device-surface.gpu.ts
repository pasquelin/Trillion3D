// A lost WebGPU device leaves nothing stale to present (`lostDeviceSurfacePage.ts`). The engine
// presents into a canvas of its own and publishes it as `presentedSurface`; once the device is
// destroyed, that canvas must be withdrawn and its context unconfigured, the next render must
// raise `WEBGPU_LOST`, and the loss must be announced under that name. Before the loss the image
// holds the fixture's triangles: a stale copy would have carried them.
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { loadPage, runOnDawn } from '../kit/onDawn.ts'
import type { run } from './lostDeviceSurfacePage.ts'

declare global {
  var lostDeviceSurface: { run: typeof run }
}

test('a lost device withdraws its surface, raises WEBGPU_LOST and says so', async () => {
  await loadPage(resolve(import.meta.dirname, 'lostDeviceSurfacePage.ts'), 'lostDeviceSurface')
  const pageErrors: string[] = []
  const { before, after, events, errors } = await runOnDawn(
    () => globalThis.lostDeviceSurface.run(),
    null,
    pageErrors,
  )
  assert.deepEqual([...errors, ...pageErrors], [])
  assert.ok(before.litChannels > 0, 'the image held nothing before the loss: the proof is empty')
  assert.ok(before.configured, 'the composed surface was not configured before the loss')
  assert.equal(after.published, false, 'the canvas of a lost device is still published')
  assert.equal(after.configured, false, 'the canvas of a lost device still holds its image')
  assert.equal(after.frameHeld, false, 'a frame of the lost device is still held')
  assert.match(after.renderError ?? '', /WEBGPU_LOST/, 'the next render did not raise WEBGPU_LOST')
  assert.equal(after.loss?.context?.code, 'WEBGPU_LOST', JSON.stringify(events))
  // The loss this proof causes is the only one: an uncaptured error would be announced first.
  assert.ok(
    events.every((e) => !/failed/.test(e.phase) && e.context?.reason !== 'uncaptured-error'),
    JSON.stringify(events),
  )
})
