// The cut's six indirect arguments are armed by a dispatch of its pass (`dagArm`), where six
// copies of `work` to `dispatchArgs` would cut that pass. The shipped kernel runs over its six
// lanes: each list's record holds what the copy of its two words gave the argument, z still one —
// the drawn journal one workgroup at least —; and the kernel binds nothing of the selection's
// group, so no dispatch reads an argument a group it uses binds writable.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../texture/shaderRun.fixture.ts'
import { lcgRandom } from '../../../../math/src/sequence/random.ts'
import { dagWorkLayout } from './shader/floorWgsl.ts'
import { DAG_ARGS, DAG_ARGS_INITIAL, DAG_ARM_BINDING, DAG_ARM_WGSL } from './shader/armWgsl.ts'
import { DAG_BINDINGS_WGSL, dagBindEntries } from './shader/bindings.ts'
import { DAG_SELECTION_SHADER } from './shader/shader.ts'
import { buildDagArm, dagArmGroup, dagArmLayout } from './arm.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { wgslSource } from '../../../../math/src/wgsl/source.fixture.ts'

test('each record holds the words the arming copy carried, z one', () => {
  for (const blockCount of [1, 7, 64]) {
    const layout = dagWorkLayout(blockCount)
    const r = lcgRandom(blockCount),
      work = Array.from({ length: layout.words }, () => Math.floor(r() * 2 ** 32))
    const args = [...DAG_ARGS_INITIAL]
    const { dagArm } = shaderRun<{ dagArm: (list: number) => void }>(DAG_ARM_WGSL, ['dagArm'], {
      armWork: work,
      armArgs: args,
      DRAWN_GROUPS: layout.drawnGroups,
      CAND_GROUPS: layout.candGroups,
      LIVE_GROUPS: layout.liveGroups,
      LIST_GROUPS: layout.listGroups,
    })
    for (let lane = 0; lane < 6; lane++) dagArm(lane)
    // `copyBufferToBuffer(work, groups * 4, dispatchArgs, 0, 8)`: x and y, then the one z.
    const copied = (groups: number) => [work[groups], work[groups + 1], 1]
    const record = (offset: number) => args.slice(offset / 4, offset / 4 + 3)
    assert.deepEqual(record(DAG_ARGS.drawn), copied(layout.drawnGroups), `${blockCount}: drawn`)
    assert.deepEqual(record(DAG_ARGS.cand), copied(layout.candGroups), `${blockCount}: cand`)
    assert.deepEqual(record(DAG_ARGS.live), copied(layout.liveGroups), `${blockCount}: live`)
    assert.deepEqual(record(DAG_ARGS.list0), copied(layout.listGroups), `${blockCount}: list 0`)
    assert.deepEqual(record(DAG_ARGS.list1), copied(layout.listGroups + 2), `${blockCount}: list 1`)
    assert.deepEqual(record(DAG_ARGS.restore), copied(layout.listGroups + 4), `${blockCount}: back`)
  }
  // An empty journal still arms one workgroup: its first thread saves the length it leaves.
  const layout = dagWorkLayout(1),
    args = [...DAG_ARGS_INITIAL]
  const { dagArm } = shaderRun<{ dagArm: (list: number) => void }>(DAG_ARM_WGSL, ['dagArm'], {
    armWork: new Array(layout.words).fill(0),
    armArgs: args,
    ...{ DRAWN_GROUPS: layout.drawnGroups, CAND_GROUPS: layout.candGroups },
    ...{ LIVE_GROUPS: layout.liveGroups, LIST_GROUPS: layout.listGroups },
  })
  for (let lane = 0; lane < 6; lane++) dagArm(lane)
  assert.deepEqual(args.slice(0, 3), [1, 1, 1], 'the empty journal: one workgroup')
  assert.deepEqual(args.slice(3, 6), [0, 0, 1], 'an empty candidate list: none')
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
        DRAWN_GROUPS: dagWorkLayout(4).drawnGroups,
        CAND_GROUPS: dagWorkLayout(4).candGroups,
        LIVE_GROUPS: dagWorkLayout(4).liveGroups,
        LIST_GROUPS: dagWorkLayout(4).listGroups,
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
