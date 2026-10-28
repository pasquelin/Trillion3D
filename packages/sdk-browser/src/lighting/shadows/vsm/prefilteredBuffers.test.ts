// The prefiltered distant shadow's buffers (`resources.ts`): made only with a layout that asks them, bound by
// name with the separable pool by the frame's parity.
import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslSource } from '../../../../../math/src/wgsl/source.fixture.ts'
import { MAPS } from './prefiltered.fixture.ts'
import { device } from './prefilteredBuffers.fixture.ts'
import { vsmResourceBytes } from './layoutBytes.ts'
import {
  VSM_FILTER_ARGS_INIT,
  VSM_FILTERABLE_PAGE_BYTES,
  vsmHistoryHeader,
  vsmHistoryLayout,
} from './prefilteredConstants.ts'
import {
  createVsmResources,
  vsmBindGroupEntries,
  vsmBindingsWgsl,
  vsmFrameParity,
  type VsmBindingSpec,
} from './resources.ts'

test('only a layout that asks it makes the pools, the lists, the arguments and the history', () => {
  const off = device()
  const plain = createVsmResources(off.device, MAPS)
  assert.equal(plain.filterable, undefined)
  assert.ok(!off.buffers.some((buffer) => buffer.label?.startsWith('vsm.filterable')))
  const fake = device()
  const res = createVsmResources(fake.device, { ...MAPS, prefilteredDistant: true })
  const { filterable } = res
  assert.ok(filterable)
  const sizeOf = (label: string) =>
    fake.buffers.find((buffer) => buffer.label === `vsm.${label}`)!.size
  const pool = 256 * VSM_FILTERABLE_PAGE_BYTES
  assert.deepEqual(['filterableSeparate0', 'filterableSeparate1', 'filterableMerged'].map(sizeOf), [
    pool,
    pool,
    pool,
  ])
  assert.ok(
    !fake.buffers.some((buffer) => buffer.label === 'vsm.filterableTemp'),
    'the merged pool is the temporary one',
  )
  assert.notEqual(filterable.separate[0], filterable.separate[1])
  assert.deepEqual([sizeOf('filterableArgs'), sizeOf('filterableArgsInit')], [48, 48])
  assert.equal(sizeOf('filterablePages'), 2 * 256 * 4)
  assert.equal(sizeOf('filterableHistory'), vsmHistoryLayout(res.layout).words * 4)
  assert.equal(filterable.historyValid, false)
  assert.equal(filterable.active, false)
  assert.equal(res.bytes, vsmResourceBytes(res.layout), 'the bytes counted are the bytes made')
  // The empty form of the arguments, written once to its own buffer; the history's header names its regions.
  const writesTo = (buffer: GPUBuffer) => fake.writes.filter((w) => w.buffer === buffer)
  const [init] = writesTo(filterable.argsInit)
  assert.deepEqual(Array.from(init.data), [...VSM_FILTER_ARGS_INIT])
  const [header] = writesTo(filterable.history)
  assert.deepEqual(
    Array.from(header.data),
    Array.from(vsmHistoryHeader(vsmHistoryLayout(res.layout), 0)),
  )
  assert.ok(filterable.args.usage & GPUBufferUsage.INDIRECT, 'dispatched from')
})

test('the filtered buffers bind by name, the separable pool by the frame’s parity', () => {
  const fake = device()
  const res = createVsmResources(fake.device, { ...MAPS, prefilteredDistant: true })
  const specs: VsmBindingSpec[] = [
    { resource: 'filterableSeparate', binding: 0, access: 'atomic' },
    { resource: 'filterableSeparate', binding: 1, prev: true },
    { resource: 'filterableMerged', binding: 2 },
    { resource: 'filterableMerged', binding: 3, access: 'atomic', name: 'vsmFilterableTemp' },
    { resource: 'filterableArgs', binding: 4, access: 'atomic' },
    { resource: 'filterablePages', binding: 5, access: 'read_write' },
    { resource: 'filterableHistory', binding: 6 },
  ]
  const { separate, merged, args, pages, history } = res.filterable!
  const bound = () =>
    vsmBindGroupEntries(res, specs).map((entry) => (entry.resource as GPUBufferBinding).buffer)
  const parity = vsmFrameParity(res)
  assert.deepEqual(bound(), [
    ...[separate[parity], separate[1 - parity], merged, merged],
    ...[args, pages, history],
  ])
  res.swapFrames()
  assert.equal(vsmFrameParity(res), 1 - parity)
  assert.deepEqual(bound().slice(0, 2), [separate[1 - parity], separate[parity]], 'the pools swap')
  const text = wgslSource(vsmBindingsWgsl(1, specs, res.layout))
  for (const line of [
    '@group(1) @binding(0) var<storage,read_write> vsmFilterableSeparate:array<atomic<u32>>;',
    '@group(1) @binding(1) var<storage,read> vsmPrevFilterableSeparate:array<u32>;',
    '@group(1) @binding(3) var<storage,read_write> vsmFilterableTemp:array<atomic<u32>>;',
    'fn vsmFilterableMergedLoad(i:u32)->u32',
    'fn vsmFilterablePagesStore(i:u32,v:u32)',
    'fn vsmFilterableHistoryLoad(i:u32)->u32',
  ])
    assert.ok(text.includes(line), line)
  // A set without them refuses a spec that names them.
  const plain = createVsmResources(device().device, MAPS)
  assert.throws(() => vsmBindGroupEntries(plain, specs), /without the prefiltered distant shadow/)
})
