// A parent that turns with its children composed on the GPU writes no CPU world: the GPU cut,
// which compares the CPU worlds it is sent, must still cut again under the composed ones. The roots
// pass announces the move to the selection on exactly the frames a parent moved.
import { NO_INDEX } from '../../../../math/src/constants.ts'
import { PACKED_MATRIX_WORDS } from '../../../../math/src/float/splitDouble.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { composeWebgpuPlacements } from './gpuCompose.ts'
import { askComposedPlacements } from './gpuComposeFrame.ts'
import { pipelinesCompiling, pipelinesSettled } from '../../lighting/deferred/compileLedger.ts'
import { session, turn } from './composeSession.fixture.ts'

test("a parent's turn advances the cut's world revision on the frame it moved, and only then", async () => {
  const { rt, rows, frame, ready } = session()
  const parent = {},
    local = turn(0.4)
  const links = [0, 1].map((index) => ({ rows, index, local }))
  composeWebgpuPlacements(rt, parent, turn(0), links, true)
  await ready()
  assert.equal(frame(), 1, 'the link frame: the links went up, the cut is told')
  assert.equal(frame(), 1, 'a still parent moves nothing')
  composeWebgpuPlacements(rt, parent, turn(0.1), [], false)
  assert.equal(frame(), 2, 'the turn: no row written, the cut is told')
  assert.equal(frame(), 2, 'the next still frame keeps the cut')
  composeWebgpuPlacements(rt, parent, turn(0.2), [], false)
  composeWebgpuPlacements(rt, parent, turn(0.3), [], false)
  assert.equal(frame(), 3, 'two sends before one frame: one cut')
  composeWebgpuPlacements(rt, parent, turn(0.3), [], false)
  assert.equal(frame(), 3, 'the same world sent again moves nothing')
})

test('a parent unlinked and linked anew starts from its new world: no motion from its old one', async () => {
  const { rt, rows, frame, ready } = session()
  const parent = {},
    links = [0, 1].map((index) => ({ rows, index, local: turn(0) }))
  composeWebgpuPlacements(rt, parent, turn(0), links, true)
  await ready()
  const linked = frame()
  composeWebgpuPlacements(rt, parent, turn(0), [], true)
  assert.deepEqual([...rt.compose!.parentOf], [NO_INDEX, NO_INDEX])
  composeWebgpuPlacements(rt, parent, turn(1), [], false)
  composeWebgpuPlacements(rt, parent, turn(2), links.slice(1), true)
  assert.deepEqual([...rt.compose!.parentOf], [NO_INDEX, 0], 'its slot taken again, one root')
  assert.equal(frame(), linked + 1, 'linked at its new world: the cut is told once')
})

test('the compose kernels are asked once a parent links rows, the frames held until they compiled off the thread', async () => {
  const { rt, rows, frame, device, compiled } = session()
  askComposedPlacements(rt, device)
  assert.equal(pipelinesCompiling(device), false, 'no link, nothing asked')
  const links = [0, 1].map((index) => ({ rows, index, local: turn(0) }))
  composeWebgpuPlacements(rt, {}, turn(0), links, true)
  askComposedPlacements(rt, device)
  assert.equal(pipelinesCompiling(device), true, 'the next frame is held on them')
  await pipelinesSettled(device, true)
  assert.equal(pipelinesCompiling(device), false)
  frame()
  // Two kernels since the velocity reads the linked roots' motion from the kept poses
  // (`previousPoses.ts`): the motion pass is gone.
  assert.deepEqual(
    compiled,
    { sync: 0, async: 2 },
    'the worlds and roots kernels, off the frame, once',
  )
})

test('the compose passes make their groups once, then only when a buffer one names is replaced', async () => {
  const { rt, rows, frame, ready, device, bindGroups } = session()
  const parent = {},
    links = [0, 1].map((index) => ({ rows, index, local: turn(0) }))
  composeWebgpuPlacements(rt, parent, turn(0), links, true)
  await ready()
  const image = () => (frame(), bindGroups.length)
  const made = image()
  assert.equal(image(), made, 'a still frame makes no group')
  composeWebgpuPlacements(rt, parent, turn(0.5), [], false)
  assert.equal(image(), made, 'nor does a turning parent: its worlds go up in the same buffer')
  rt.rootWorlds!.worlds = device.createBuffer({
    size: 512,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  assert.equal(
    image(),
    made + 2,
    "the roots' worlds made again: the worlds and roots passes bind them, once",
  )
  assert.equal(image(), made + 2)
})

test('a link or a parent that moves sends its own words alone, never the whole tables', async () => {
  const { rt, rows, frame, ready, writes } = session()
  const a = {},
    b = {},
    link = (local: number[]) => [{ rows, index: 1, local }]
  composeWebgpuPlacements(rt, a, turn(0), [{ rows, index: 0, local: turn(0.4) }], true)
  composeWebgpuPlacements(rt, b, turn(1), link(turn(0.4)), true)
  await ready()
  frame()
  const sent = (label: string) =>
    writes
      .filter((write) => (write.buffer as { label?: string }).label === label)
      .map((write) => [write.offset, (write.data as { byteLength: number }).byteLength])
  const matrix = PACKED_MATRIX_WORDS * 4
  writes.length = 0
  composeWebgpuPlacements(rt, b, turn(1), link(turn(0.5)), false)
  composeWebgpuPlacements(rt, a, turn(0.1), [], false)
  frame()
  assert.deepEqual(sent('Trillion3D composed locals'), [[matrix, matrix]], "root 1's link")
  assert.deepEqual(sent('Trillion3D composed parents of'), [[4, 4]])
  assert.deepEqual(sent('Trillion3D composed parent worlds'), [[0, matrix]], 'parent a alone')
  writes.length = 0
  composeWebgpuPlacements(rt, a, turn(0.1), [], true)
  composeWebgpuPlacements(rt, a, turn(0.1), [{ rows, index: 0, local: turn(0.4) }], true)
  frame()
  assert.deepEqual(sent('Trillion3D composed parents of'), [[0, 4]], 'root 0 left and came back')
})
