// #840: every drawn page is posed at every frame, and a written matrix recomposes its node: sponza
// recomposed 1 465 pages a frame for poses that never moved.
import test from 'node:test'
import assert from 'node:assert/strict'
import { forgetHostPose, setHostPose } from './pagePose.ts'
import type { HostMesh } from './resources.ts'

test('a page posed as it stands writes nothing; a move, or a page back in the graph, writes', () => {
  let writes = 0
  const mesh = { matrix: { fromArray: () => writes++ } } as unknown as HostMesh
  const at = (x: number) => ({ elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1] })
  setHostPose(mesh, at(1))
  setHostPose(mesh, at(1))
  assert.equal(writes, 1, 'the same pose again')
  setHostPose(mesh, at(2))
  assert.equal(writes, 2, 'a moved placement')
  forgetHostPose(mesh)
  setHostPose(mesh, at(2))
  assert.equal(writes, 3, 'detached, then attached again')
})
