// The world's fade follows the camera: cuts of a still camera — pages arriving cut again — all hold
// the world DAG to one scale of the threshold, and a camera that moves takes the next. On the
// generated world of three cells of four objects beside twelve placements.
import test from 'node:test'
import assert from 'node:assert/strict'
import { packDagSelection } from './pack.ts'
import { createDagResources } from './resources.ts'
import { createDagRuntime } from './runtime.ts'
import { followWorldLinks } from './worldFollow.ts'
import { stepsOnly } from './stepsOnly.fixture.ts'
import { ruleDag } from '../../page/cut/cutRule.fixture.ts'
import { worldDag } from '../../scene/worldSuperRoots.fixture.ts'
import { SHADOW_LIMITS } from '../../webgpu/pages/testScenes.fixture.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { cameraSelectionUniforms } from '../core/selection.ts'
import { stripCamera } from '../../page/cut/cutRuleBackends.fixture.ts'
import type { DagRoot } from './types.ts'

test('a still camera holds the world to one scale; a moved one takes the next', async () => {
  const world = worldDag(),
    manifest = ruleDag(8) as unknown as DagRoot
  const packed = packDagSelection([...Array.from({ length: 12 }, () => manifest), world as never])
  const resources = (await createDagResources(
    fakeDevice({ limits: SHADOW_LIMITS }).device,
    packed,
  ))!
  const runtime = stepsOnly(createDagRuntime(resources))
  const selection = followWorldLinks(runtime, resources)
  const camera = stripCamera(world)
  const scales = (moves: number[]) =>
    moves.map((x) => {
      camera.eye[0] = x
      selection.dispatch(cameraSelectionUniforms(camera, 0.1, [64, 64]))
      return packed.world!.scale
    })
  const [first, still, again, moved, settled] = scales([0, 0, 0, 1, 1])
  assert.deepEqual([still, again], [first, first], 'pages arriving under a still eye')
  assert.notEqual(moved, first, 'the camera moved: the next scale')
  assert.equal(settled, moved)
})
