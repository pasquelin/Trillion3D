// A glass pane over a floor in light casts no contact-shadow darkening beyond the maps' transmission:
// the contact ray (`vsmScreenRayCast`) crosses an opaque wall of the depth and stops there, crosses a
// transparent pane of the same depth and place and goes on to its whole length, as over the bare
// floor — while the engine's one screen march does meet the pane, flagged in front (the reflection
// keeps it). The scene is generated (`glassContactPage.ts`).
//
//   node bench/dawn/proofs.ts tests/gpu/vsm/glassContact.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { loadPage, runOnDawn } from '../kit/onDawn.ts'

test('a transparent pane in front of the floor is no contact occluder, an opaque wall is', async () => {
  const page = (await loadPage(
    resolve(import.meta.dirname, 'glassContactPage.ts'),
    'vsmGlassContact',
  )) as typeof import('./glassContactPage.ts')
  const pageErrors: string[] = []
  const read = await runOnDawn(page.testGlassContact, undefined, pageErrors)
  console.log(JSON.stringify(read))
  assert.deepEqual([...read.errors, ...pageErrors], [])
  assert.equal(read.floor, read.rayLength, 'the bare floor: nothing blocks the light')
  assert.ok(read.wall < read.rayLength * 0.5, `an opaque wall blocks it: ${read.wall}`)
  assert.equal(read.pane, read.rayLength, 'the pane: no darkening, the transmission is its shadow')
  assert.deepEqual(read.paneSeen, { stopped: true, front: true }, 'the march meets the pane')
})
