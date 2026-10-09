// A cut is made before any frame: nothing it waits on may need the queue to move. A browser
// resolves a mapping, or the queue's submitted work, only as the queue progresses — before the
// first frame, never —, so a making that waited on one would hang the opening where a device
// that answers at once lets it by. Each sub-step is named as it begins, so an opening that waits
// says which one (`cutSteps.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { createGpuDagSelection, packDagSelection } from './selection.ts'
import { packed } from './selectionHelpers.fixture.ts'
import { dagFixture } from '../../page/selection/dag.fixture.ts'
import { mockDagDevice } from './selection.fixture.ts'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'

/** `device` with a queue that never moves: its submitted work, and every mapping, never settle. */
function stalledQueue(device: GPUDevice) {
  const never = () => new Promise<never>(() => {})
  device.queue.onSubmittedWorkDone = never
  const create = device.createBuffer.bind(device)
  device.createBuffer = (descriptor) => Object.assign(create(descriptor), { mapAsync: never })
  return device
}

test('a cut is made on a queue that never moves, each sub-step named as it begins', async () => {
  installGpuGlobals()
  const dag = packDagSelection(packed(dagFixture()).roots)
  const notes: string[] = []
  let timed: { took: { step: string }[] } | undefined
  const made = createGpuDagSelection(stalledQueue(mockDagDevice(dag).device), dag, {
    progress: (note) => notes.push(note),
    timed: (steps) => (timed = steps),
  })
  const stalled = new Promise<'stalled'>((settle) => setTimeout(() => settle('stalled'), 5000))
  const cut = await Promise.race([made, stalled])
  if (cut === 'stalled') assert.fail('the making waits on queue progress')
  assert.ok(cut, 'and makes the cut')
  const steps = ['tables', 'shader module', 'pipelines', 'arm', 'uploads']
  assert.deepEqual(
    timed?.took.map(({ step }) => step),
    steps,
  )
  for (const step of steps)
    assert.ok(
      notes.some((note) => note.startsWith(step)),
      step,
    )
  assert.ok(notes.some((note) => /^pipelines: \d+\/\d+, dag\w+ after \d+ ms/.test(note)))
  cut.dispose()
})
