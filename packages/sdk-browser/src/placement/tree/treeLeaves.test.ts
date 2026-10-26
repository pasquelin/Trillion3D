// A root a growth appends into the running cut's room, in place, waits beside the session's roots
// until it joins them, a frame later or more (`../growth/webgpuGrowth.ts`); the cut draws it meanwhile, and its
// tree takes its leaf on the frame it is appended (`runtimeAppend.ts` touches it). The leaves pass
// runs over the roots the root tables hold — those taken in place included —, the count the rows,
// root boxes and entries passes run over too: an appended root's leaf is written that frame, never
// left at the zero box that stretches its group to the origin until it moves. A still root, a cloth
// or a rope whose root never moves, would keep it for ever.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { leafKernel, treeLeaves } from './treeLeaves.ts'
import { pipelinesSettled } from '../../lighting/deferred/compileLedger.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'

test('a root taken in place has its leaf written on the frame the cut takes it', async () => {
  const { device } = fakeDevice()
  const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  const buffer = (label: string, size: number) => device.createBuffer({ label, size, usage })
  const view = () =>
    device
      .createTexture({ size: [8, 8], format: 'r32uint', usage: GPUTextureUsage.TEXTURE_BINDING })
      .createView()
  // Two roots of the session, and a third the running cut took in place, sent at its rank.
  const rt = {
    gpu: { device },
    run: { gpuComputeDispatches: 0 },
    rootWorlds: {
      worlds: buffer('Trillion3D root worlds', 3 * 128),
      sent: 2,
      held: 3,
      whole: false,
    },
  } as unknown as WebgpuPagesRuntime
  const leaves = treeLeaves(rt)
  assert.equal(leaves.ready(false), false, 'its kernel is asked, not yet compiled')
  await pipelinesSettled(device, true)
  assert.ok(leaves.ready(false), 'the worlds it reads are on the GPU')
  const tables = {
    members: buffer('leaves', 3 * 48),
    nodes: view(),
    frames: view(),
    parented: false,
  }
  // The leaves kernel, compiled off the frame before the frame encodes.
  leafKernel(false)(device).ask()
  await pipelinesSettled(device)
  // The appended root, rank 2, named by the append's touch.
  leaves.encode(device.createCommandEncoder(), tables, {
    ranks: Int32Array.of(2),
    count: 1,
    whole: false,
  })
  const [rootCount, listed] = rt.treeLeaves!.pass.params[0].words
  assert.equal(listed, 1, 'one leaf named')
  assert.ok(2 < rootCount, `rank 2 is under the pass's ${rootCount} roots: its leaf is written`)
  assert.equal(rootCount, rt.rootWorlds!.held, 'the roots the tables hold, the one count')
})
