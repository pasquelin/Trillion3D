// The page marking is one compute pass (`vsmEncode.ts` opens it): the physical page address update
// first, then the marking's clears, page rects, coarse pages and pixels (`markingPass.ts`), each
// dispatch seeing the writes of those before it — the order the separate passes kept. The tables
// a clear clears in the pages of the maps it walks are cleared in one walk of them
// (`vsmResetPageTableWgsl`): each table at the texels, mips and stride its own kernel cleared, so the
// tables hold what the four clears left.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fakeDevice } from '../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { replayWrites } from '../../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import {
  createVsmMarking,
  perPageSlot,
  VSM_PER_PAGE_BIN_COUNT,
  vsmMarkingBytes,
} from './markingPass.ts'
import {
  VSM_FRONT_DEPTH_BINDING,
  VSM_WATER_DEPTH_BINDING,
  vsmCoarseMarkingWgsl,
  vsmMarkingClears,
  vsmPixelPageMarkingWgsl,
  vsmResetPageTableWgsl,
  type VsmClearTarget,
} from './markingWgsl.ts'
import { markingFrontLayer, newFrontSeen, newMarkingFront } from './frame/vsmFrontLayer.ts'
import { beginCamera } from '../../../frame/backend/state/previousCamera.ts'
import type { EngineCamera } from '../../../camera/engineCamera.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { createVsmResources } from './resources.ts'
import { vsmLayout } from './layout.ts'
import { pipelinesSettled } from '../../deferred/compileLedger.ts'
import { AS_IS_FLAG, UNLIT_FLAG } from '../../../materials/surface/surfaceModelWord.ts'

const TARGETS: VsmClearTarget[] = ['pageRequests', 'pageTable', 'pageMarks', 'receiverCover']

/** The text of table n of a clear kernel: its binding, store and mip clear, and its page body,
 *  its own suffix read as `#`. */
function tableOf(code: string, n: number) {
  const declared = code.slice(
    code.indexOf(`@group(0) @binding(${4 + n})`),
    code.indexOf('\n}\n', code.indexOf(`fn vsmClearMip${n}(`)) + 3,
  )
  const body = code
    .split('\n')
    .filter((line) => new RegExp(`vsmClear(Store|Mip)${n}\\(|\\ba${n}=`).test(line))
    .filter((line) => line.startsWith('    '))
    .join('\n')
  const named = (text: string) =>
    text.replace(new RegExp(`(vsmClear(?:Store|Mip|Dest)|\\ba)${n}\\b`, 'g'), '$1#')
  return { declared: named(declared), body: named(body) }
}

test('one walk clears each table as its own kernel did', () => {
  const layout = vsmLayout({ coverMode: 'suns', fullMapCapacity: 63, sunMapCapacity: 18 })
  const fused = vsmResetPageTableWgsl(TARGETS, layout)
  for (const [n, target] of TARGETS.entries()) {
    const own = tableOf(vsmResetPageTableWgsl([target], layout), 0),
      shared = tableOf(fused, n)
    assert.ok(own.body.length > 0, target)
    assert.equal(shared.declared.replace(`binding(${4 + n})`, 'binding(4)'), own.declared, target)
    assert.equal(shared.body, own.body, target)
  }
  // The walk itself, the same for one table or four.
  const walk = (code: string) => code.slice(code.indexOf('@compute'), code.indexOf('let po='))
  assert.equal(walk(fused), walk(vsmResetPageTableWgsl(['pageTable'], layout)))
})

test('the clears in their order, by the maps they walk: every map’s requests, tables and flags, a receiver cover by the maps it holds', () => {
  const at = (coverMode: 'none' | 'suns' | 'all') =>
    vsmMarkingClears(vsmLayout({ coverMode, fullMapCapacity: 7 }))
  const requests = { walk: 'all', targets: ['pageRequests'] },
    tables = { walk: 'all', targets: ['pageTable', 'pageMarks'] }
  const receiver = (walk: string, targets: string[]) => ({ walk, targets })
  assert.deepEqual(at('suns'), {
    requests,
    receiver: receiver('directionalOnly', ['receiverCover']),
    tables,
  })
  assert.deepEqual(at('all'), { requests, receiver: receiver('all', ['receiverCover']), tables })
  assert.deepEqual(at('none'), { requests, receiver: receiver('all', []), tables })
})

test('the marking records into the pass it is given: its clears, rects and coarse pages in order, the raster marks and rects between the clears', async () => {
  const { device } = fakeDevice({ limits: { maxStorageBufferBindingSize: 1 << 27 } })
  const res = createVsmResources(device, { coverMode: 'suns', fullMapCapacity: 63, poolPages: 256 })
  const marking = createVsmMarking(device, res)
  const steps: string[] = []
  const pass = {
    setPipeline: (p: { entryPoint: string }) => steps.push(p.entryPoint),
    setBindGroup() {},
    dispatchWorkgroups: () => void steps.push('dispatch'),
    end: () => void steps.push('end'),
  } as unknown as GPUComputePassEncoder
  const bin = { offset: 0, count: 1 },
    none = { offset: 0, count: 0 }
  const frame = {
    mapCount: 1,
    claimed: 1,
    singleMaps: 1,
    perspective: true,
    perPage: {
      ids: new Uint32Array(2),
      all: [bin, none, none, none],
      directionalOnly: [bin, none, none, none],
    },
  }
  marking.encode(pass, frame)
  await pipelinesSettled(device)
  steps.length = 0
  marking.encode(pass, frame)
  const clears = vsmMarkingClears(res.layout)
  assert.deepEqual(steps, [
    ...['vsmClearPageTables', 'dispatch'],
    ...(clears.receiver.targets.length ? ['vsmClearPageTables', 'dispatch'] : []),
    ...['vsmClearRasterMarks', 'dispatch', 'vsmInitPageRects', 'dispatch'],
    ...['vsmClearPageTables', 'dispatch', 'vsmMarkCoarse', 'dispatch'],
  ])
})

test('a device aligning at 512 lays the per-page slots 512 bytes apart', async () => {
  const fake = fakeDevice({
    limits: { maxStorageBufferBindingSize: 1 << 27, minUniformBufferOffsetAlignment: 512 },
  })
  const { device } = fake
  const res = createVsmResources(device, { coverMode: 'suns', fullMapCapacity: 63, poolPages: 256 })
  const marking = createVsmMarking(device, res)
  const offsets: number[] = []
  const pass = {
    setPipeline() {},
    setBindGroup: (_group: number, _set: unknown, dynamic?: readonly number[]) =>
      void (dynamic && offsets.push(dynamic[0])),
    dispatchWorkgroups() {},
    end() {},
  } as unknown as GPUComputePassEncoder
  const bins = [3, 2, 1, 4].map((count, b) => ({ offset: 2 * b, count }))
  const frame = {
    mapCount: 1,
    claimed: 1,
    singleMaps: 1,
    perspective: true,
    perPage: { ids: new Uint32Array(20), all: bins, directionalOnly: bins },
  }
  marking.encode(pass, frame)
  await pipelinesSettled(device)
  offsets.length = 0
  marking.encode(pass, frame)
  const perPage = fake.buffers.find((b) => b.label === 'vsm.marking.perPage')!
  const params = fake.buffers.find((b) => b.label === 'vsm.marking.params')!
  assert.equal(perPage.size, 2 * VSM_PER_PAGE_BIN_COUNT * 512)
  assert.equal(vsmMarkingBytes(device.limits), params.size + perPage.size)
  // Each bin's words open its 512-byte slot: all bins, then the directional-only ones.
  const words = new Uint32Array(perPage.size / 4)
  replayWrites(
    words.buffer,
    fake.writes.filter((w) => w.buffer === (perPage as unknown as GPUBuffer)),
  )
  for (let slot = 0; slot < 2 * VSM_PER_PAGE_BIN_COUNT; slot++) {
    const bin = bins[slot % VSM_PER_PAGE_BIN_COUNT]
    assert.deepEqual([words[slot * 128], words[slot * 128 + 1]], [bin.offset, bin.count])
  }
  // The clears bind each bin's slot at its 512-byte step, each in the set of the maps it walks.
  const clears = vsmMarkingClears(res.layout)
  const slotsOf = (step: keyof typeof clears) =>
    Array.from(
      { length: VSM_PER_PAGE_BIN_COUNT },
      (_, b) => perPageSlot(clears[step].walk === 'directionalOnly', b) * 512,
    )
  assert.deepEqual(offsets, [
    ...slotsOf('requests'),
    ...(clears.receiver.targets.length ? slotsOf('receiver') : []),
    ...slotsOf('tables'),
  ])
})

test('the frame opens the marking pass: the stats cleared before it, the address update first', () => {
  const encode = readFileSync(new URL('./frame/vsmEncode.ts', import.meta.url), 'utf8')
  const at = (text: string) => encode.indexOf(text)
  const order = [
    'encoder.clearBuffer(res.stats)',
    'const marking = steps.pass(MARKING_PASS)',
    'encodeVsmPageCarry(marking, res, pmFrame)',
    'vsm.marking.encode(marking, markingFrame)',
    'encodeVsmPageMapping(steps, res, pmFrame)',
  ].map(at)
  assert.ok(
    order.every((k, i) => k > 0 && (i === 0 || k > order[i - 1])),
    `${order}`,
  )
})

test("a local map asks its last mip's page where its record says coarse, a distant light always", () => {
  const code = vsmCoarseMarkingWgsl(vsmLayout({ coverMode: 'suns', fullMapCapacity: 7 }))
  // The sun's level and the local map are read by the one flag of their records.
  const branch = '}else if(pd.coarseLevel||pd.distant){'
  const local = code.slice(code.indexOf(branch))
  assert.ok(code.includes('if(pd.lightKind==LIGHT_KIND_DIRECTIONAL){'), 'the sun branch')
  assert.ok(local.startsWith(branch), 'the local branch: flagged, or a distant light')
  assert.ok(local.includes('vsmTableEntryOf(handle,VSM_MIPS-1u,vec2u(0u,0u))'), 'its last mip')
})
