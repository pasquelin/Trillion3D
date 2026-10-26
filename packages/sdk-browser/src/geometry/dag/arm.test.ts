// The cut's seven indirect arguments are armed by a dispatch of its pass (`dagArm`), where seven
// copies of `work` to `dispatchArgs` would cut that pass. The shipped kernel runs over its seven
// lanes: each list's record holds what the copy of its two words gave the argument, z still one —
// the visible list and the descent queues one workgroup at least —; and the kernel binds nothing of
// the selection's group, so no dispatch reads an argument a group it uses binds writable.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { lcgRandom } from '../../../../math/src/sequence/random.ts'
import { dagWorkLayout } from './shader/floorWgsl.ts'
import { DAG_ARGS, DAG_ARGS_INITIAL, DAG_ARM_BINDING, DAG_ARM_WGSL } from './shader/armWgsl.ts'
import { DAG_BINDINGS_WGSL, dagBindEntries } from './shader/bindings.ts'
import { DAG_SELECTION_SHADER } from './shader/selectionShader.fixture.ts'
import { buildDagArm, dagArmGroup, dagArmLayout } from './arm.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { wgslSource } from '../../../../math/src/wgsl/source.fixture.ts'

/** The kernel over `work`'s words, every lane run, the arguments it leaves. */
function armed(layout: ReturnType<typeof dagWorkLayout>, work: number[]) {
  const args = [...DAG_ARGS_INITIAL]
  const { dagArm } = shaderRun<{ dagArm: (list: number) => void }>(DAG_ARM_WGSL, ['dagArm'], {
    armWork: work,
    armArgs: args,
    VISIBLE_GROUPS: layout.visibleGroups,
    CAND_GROUPS: layout.candGroups,
    POST_NODE_GROUPS: layout.postNodeGroups,
    POST_CLUSTER_GROUPS: layout.postClusterGroups,
    QUEUE_GROUPS: layout.queueGroups,
  })
  for (let lane = 0; lane < 7; lane++) dagArm(lane)
  return (offset: number) => args.slice(offset / 4, offset / 4 + 3)
}

test('each record holds the words the arming copy carried, z one', () => {
  for (const blockCount of [1, 7, 64]) {
    const layout = dagWorkLayout(blockCount)
    const r = lcgRandom(blockCount),
      work = Array.from({ length: layout.words }, () => Math.floor(r() * 2 ** 32))
    const record = armed(layout, work)
    // `copyBufferToBuffer(work, groups * 4, dispatchArgs, 0, 8)`: x and y, then the one z.
    const copied = (groups: number, least = 0) => [
      Math.max(work[groups], least),
      Math.max(work[groups + 1], least),
      1,
    ]
    assert.deepEqual(
      record(DAG_ARGS.visible),
      copied(layout.visibleGroups, 1),
      `${blockCount}: visible`,
    )
    assert.deepEqual(record(DAG_ARGS.cand), copied(layout.candGroups), `${blockCount}: cand`)
    assert.deepEqual(
      record(DAG_ARGS.postNodes),
      copied(layout.postNodeGroups),
      `${blockCount}: held items`,
    )
    assert.deepEqual(
      record(DAG_ARGS.postClusters),
      copied(layout.postClusterGroups),
      `${blockCount}: held clusters`,
    )
    DAG_ARGS.queues.forEach((queue, q) =>
      assert.deepEqual(
        record(queue),
        copied(layout.queueGroups + 2 * q, 1),
        `${blockCount}: queue ${q}`,
      ),
    )
  }
  // An empty visible list and an empty queue still arm one workgroup: their first thread writes what
  // an empty list leaves too, and clears the queue the level after next fills.
  const layout = dagWorkLayout(1)
  const record = armed(layout, new Array(layout.words).fill(0))
  assert.deepEqual(record(DAG_ARGS.visible), [1, 1, 1], 'the empty visible list: one workgroup')
  assert.deepEqual(record(DAG_ARGS.queues[0]), [1, 1, 1], 'an empty queue: one workgroup')
  assert.deepEqual(record(DAG_ARGS.cand), [0, 0, 1], 'an empty candidate list: none')
  assert.deepEqual(record(DAG_ARGS.postClusters), [0, 0, 1], 'an empty held list: none')
})

test('the arming group binds the counts read-only and the arguments, nothing of the selection', async () => {
  const { device, bindGroupLayouts, bindGroups } = fakeDevice()
  const work = { label: 'work' } as GPUBuffer,
    args = { label: 'args' } as GPUBuffer
  // An entry point of the cut's own module, on a layout of its own.
  const module = device.createShaderModule({ code: DAG_SELECTION_SHADER })
  const layout = dagArmLayout(device)
  const armPipeline = await buildDagArm(device, module, layout, dagWorkLayout(4))
  dagArmGroup(device, layout, work, args)
  assert.deepEqual(
    Array.from(bindGroupLayouts.at(-1)!.entries, (e) => [e.binding, e.buffer?.type]),
    [
      [DAG_ARM_BINDING.work, 'read-only-storage'],
      [DAG_ARM_BINDING.args, 'storage'],
    ],
  )
  // The fake device's pipeline is its stage: the list words are fixed with the layout.
  const stage = armPipeline as unknown as GPUProgrammableStage
  assert.deepEqual(
    [stage.entryPoint, stage.constants],
    [
      'dagArm',
      {
        VISIBLE_GROUPS: dagWorkLayout(4).visibleGroups,
        CAND_GROUPS: dagWorkLayout(4).candGroups,
        POST_NODE_GROUPS: dagWorkLayout(4).postNodeGroups,
        POST_CLUSTER_GROUPS: dagWorkLayout(4).postClusterGroups,
        QUEUE_GROUPS: dagWorkLayout(4).queueGroups,
      },
    ],
  )
  assert.deepEqual(
    [...bindGroups.at(-1)!.entries].map((e) => (e.resource as GPUBufferBinding).buffer),
    [work, args],
  )
  // The selection's group never names the argument buffer, nor takes a binding of the arming's.
  assert.doesNotMatch(wgslSource(DAG_BINDINGS_WGSL), /\bargs\b/)
  const taken = dagBindEntries().map(({ binding }) => binding)
  for (const binding of Object.values(DAG_ARM_BINDING))
    assert.ok(!taken.includes(binding), `binding ${binding} is the arming group's alone`)
})
