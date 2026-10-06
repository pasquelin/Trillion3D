// A parented camera selects, on the GPU, what the parentless camera of the same world pose
// selects (defect 5). Frame after frame, the engine's WebGPU selection (`parentedCameraPage.ts`)
// runs for the child camera of a host parent that is moved then rotated without the host walking
// its rig, then for the flattened camera of the same pose: the selected pages and the frustum's
// rejections must be the same, at a zero and a coarse pixel error. The CPU sites of the same
// contract are `packages/sdk-browser/src/camera/parented.test.ts`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { loadPage, runOnDawn } from '../kit/onDawn.ts'
import type { run } from './parentedCameraPage.ts'

declare global {
  var parentedCamera: { run: typeof run }
}

test('a parented camera selects on the GPU what its flattened twin selects', async () => {
  await loadPage(resolve(import.meta.dirname, 'parentedCameraPage.ts'), 'parentedCamera')
  const pageErrors: string[] = []
  const { adapter, cases, errors } = await runOnDawn(
    (pixelErrors: number[]) => globalThis.parentedCamera.run(pixelErrors),
    [0, 3.5],
    pageErrors,
  )
  assert.deepEqual([...errors, ...pageErrors], [], `WebGPU errors on ${adapter}`)
  for (const { pixelError, parented, flattened } of cases) {
    assert.deepEqual(parented, flattened, `pixel error ${pixelError}: the rig selects otherwise`)
    assert.ok(
      parented.some((frame) => frame.pages.length > 0),
      `pixel error ${pixelError}: no frame selected anything, the proof is empty`,
    )
  }
})
