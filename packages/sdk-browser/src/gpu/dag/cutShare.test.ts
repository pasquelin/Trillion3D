// The camera cut's tables hold their share of the GPU total (`../../residency/cutTableBytes.ts`):
// a cut that would pass it is refused by name before the buffer past it is made, and a growth that
// would pass it is not made — the view coarsens instead, no cut dropped ever drawn.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createGpuDagSelection } from './selection.ts'
import { gridScene } from './gridScene.fixture.ts'
import { kernelUniforms } from './selectionHelpers.fixture.ts'
import { mockDagDevice } from './selection.fixture.ts'
import { pageResidency } from './readiness.fixture.ts'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'
import { CUT_TABLE_BYTES } from '../../residency/cutTableBytes.ts'
import { defaultGpuBudget, splitMemoryBudget } from '../../residency/memoryBudget.ts'
import { DEFAULT_CPU_BUDGET } from '../../residency/memoryBudget.ts'

/** `device` counting the bytes its live buffers hold, and the most they ever held. */
function counted(device: GPUDevice) {
  const held = { now: 0, most: 0 }
  const create = device.createBuffer.bind(device)
  device.createBuffer = (descriptor: GPUBufferDescriptor) => {
    const buffer = create(descriptor),
      destroy = buffer.destroy.bind(buffer)
    held.now += descriptor.size
    held.most = Math.max(held.most, held.now)
    buffer.destroy = () => ((held.now -= descriptor.size), destroy())
    return buffer
  }
  return held
}

test('the default total funds the cut’s tables as they hold them, before the pools', () => {
  const nothing = {
    ...{ frameTargets: 0, frameShare: 0, shadowPool: 0, shadowReserve: 0 },
    ...{ bounceProbes: 0, effectTargets: 0, geometryMinimum: 0, textureMinimum: 0 },
  }
  const held = { ...nothing, cutTables: 300 * 2 ** 20 }
  assert.equal(
    defaultGpuBudget(undefined, held) - defaultGpuBudget(undefined, nothing),
    held.cutTables,
  )
  const split = splitMemoryBudget(
    defaultGpuBudget(undefined, held),
    DEFAULT_CPU_BUDGET,
    undefined,
    held,
  )
  const without = splitMemoryBudget(defaultGpuBudget(), DEFAULT_CPU_BUDGET, undefined, nothing)
  assert.equal(split.cutTables, held.cutTables)
  assert.deepEqual(
    [split.geometryPool, split.texturePool],
    [without.geometryPool, without.texturePool],
    'the pools keep what they had',
  )
})

test('a cut past its share is refused by name, before the buffer past it is made', async () => {
  installGpuGlobals()
  const { dag } = gridScene()
  const whole = (await createGpuDagSelection(mockDagDevice(dag).device, dag))!
  const bytes = whole.gpuBytes!
  whole.dispose()
  assert.ok(bytes > 0 && bytes <= CUT_TABLE_BYTES, `${bytes} bytes within the share`)
  const { device } = mockDagDevice(dag),
    held = counted(device)
  let reason = ''
  const share = Math.floor(bytes / 2)
  const refused = await createGpuDagSelection(device, dag, {
    share,
    onRefused: (why) => (reason = why),
  })
  assert.equal(refused, undefined)
  assert.match(reason, /GPU_CUT_TABLES_PAST_SHARE/)
  assert.ok(held.most <= share, `${held.most} bytes made, the share ${share}`)
  assert.equal(held.now, 0, 'nothing made outlives the refusal')
})

test('a growth past the share is not made: the view coarsens, and a dropped cut is never drawn', async () => {
  installGpuGlobals()
  const { roots, camera, dag } = gridScene()
  // Lists the fine cut passes, and a share they cannot grow in.
  Object.assign(dag, { queueEntries: 100, candCount: 1000 })
  const probe = (await createGpuDagSelection(mockDagDevice(dag).device, dag))!
  const share = probe.gpuBytes! + 64
  probe.dispose()
  const selection = (await createGpuDagSelection(mockDagDevice(dag).device, dag, { share }))!
  selection.updateResidency(pageResidency(new Uint32Array(dag.pageCount).fill(1)))
  selection.dispatch(kernelUniforms(dag, roots, camera, 0.5))
  const result = await selection.flush()
  assert.ok(selection.coarsen > 1, 'the view coarsens past the share')
  assert.ok(selection.gpuBytes! <= share, 'nothing grew past it')
  assert.ok(result && !result.dropped, 'the cut adopted ran whole')
  selection.dispose()
})

test('each buffer of the cut is asked of the budget before it is made, and a refusal makes none', async () => {
  installGpuGlobals()
  const { dag } = gridScene()
  const { device } = mockDagDevice(dag),
    held = counted(device)
  const asked: number[] = []
  const selection = (await createGpuDagSelection(device, dag, {
    admit: (bytes) => void asked.push(held.now + bytes),
  }))!
  assert.ok(asked.length > 5, 'every buffer asked')
  assert.equal(asked.at(-1), held.now, 'the last asked is what the tables hold')
  selection.dispose()
  let reason = ''
  const refused = await createGpuDagSelection(mockDagDevice(dag).device, dag, {
    admit: () => {
      throw new Error('GPU_BUDGET_UNDER_MINIMUM: the pools need it')
    },
    onRefused: (why) => (reason = why),
  })
  assert.equal(refused, undefined)
  assert.match(reason, /GPU_BUDGET_UNDER_MINIMUM/)
})
