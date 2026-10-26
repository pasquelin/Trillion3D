// The page marking is one compute pass (`vsmEncode.ts` opens it): the physical page address update
// first, then the marking's clears, page rects, coarse pages and pixels (`markingPass.ts`), each
// dispatch seeing the writes of those before it — the order the separate passes kept. The tables
// every map's pages clear are cleared in one walk of them (`vsmResetPageTableWgsl`): each table at
// the texels, mips and stride its own kernel cleared, so the tables hold what the four clears left.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fakeDevice } from '../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { replayWrites } from '../../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { createVsmMarking, VSM_PER_PAGE_BIN_COUNT, vsmMarkingBytes } from './markingPass.ts'
import {
  VSM_FRONT_DEPTH_BINDING,
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
  const layout = vsmLayout({ fullMapCapacity: 63, sunMapCapacity: 18 })
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

test('the clears by the maps they walk: every map’s tables, a receiver cover by its own maps', () => {
  const at = (receiver: 'directional' | 'none') =>
    vsmMarkingClears({ ...vsmLayout({ fullMapCapacity: 7 }), coverMode: receiver })
  assert.deepEqual(at('directional'), {
    all: TARGETS.slice(0, 3),
    directionalOnly: ['receiverCover'],
  })
  assert.deepEqual(at('none'), { all: TARGETS.slice(0, 3), directionalOnly: [] })
})

test('the marking records into the pass it is given: its clears, rects and coarse pages in order', async () => {
  const { device } = fakeDevice({ limits: { maxStorageBufferBindingSize: 1 << 27 } })
  const res = createVsmResources(device, { fullMapCapacity: 63, poolPages: 256 })
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
    ...(clears.directionalOnly.length ? ['vsmClearPageTables', 'dispatch'] : []),
    ...['vsmInitPageRects', 'dispatch', 'vsmMarkCoarse', 'dispatch'],
  ])
})

test('a device aligning at 512 lays the per-page slots 512 bytes apart', async () => {
  const fake = fakeDevice({
    limits: { maxStorageBufferBindingSize: 1 << 27, minUniformBufferOffsetAlignment: 512 },
  })
  const { device } = fake
  const res = createVsmResources(device, { fullMapCapacity: 63, poolPages: 256 })
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
  // The clears bind each bin's slot at its 512-byte step.
  const clears = vsmMarkingClears(res.layout)
  const sets = clears.directionalOnly.length ? 2 : 1
  assert.deepEqual(
    offsets,
    Array.from({ length: sets * VSM_PER_PAGE_BIN_COUNT }, (_, slot) => slot * 512),
  )
})

test('the frame opens the marking pass: the dirty flags cleared before it, the address update first', () => {
  const encode = readFileSync(new URL('./frame/vsmEncode.ts', import.meta.url), 'utf8')
  const at = (text: string) => encode.indexOf(text)
  const order = [
    'encoder.clearBuffer(res.rasterMarks)',
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

test("a local map asks its last mip's page where its record says coarse, a one-page light always", () => {
  const code = vsmCoarseMarkingWgsl(vsmLayout({ fullMapCapacity: 7 }))
  // The sun's level and the local map are read by the one flag of their records.
  const branch = '}else if(pd.coarseLevel||pd.finestMip>=VSM_MIPS-1u){'
  const local = code.slice(code.indexOf(branch))
  assert.ok(code.includes('if(pd.lightKind==LIGHT_KIND_DIRECTIONAL){'), 'the sun branch')
  assert.ok(local.startsWith(branch), 'the local branch: flagged, or a one-page light')
  assert.ok(local.includes('vsmTableEntryOf(handle,VSM_MIPS-1u,vec2u(0u,0u))'), 'its last mip')
})

test('the pixel pass marks the translucent front layer in a program of its own, before an unlit pixel leaves', () => {
  const layout = vsmLayout({ fullMapCapacity: 63, sunMapCapacity: 18 })
  const plain = vsmPixelPageMarkingWgsl(layout),
    front = vsmPixelPageMarkingWgsl(layout, true)
  for (const name of ['frontDepth', 'vsmMarkTranslucent', 'clipToFramebuffer'])
    assert.ok(!plain.includes(name), `the plain program has no ${name}`)
  assert.ok(
    front.includes(
      `@group(1) @binding(${VSM_FRONT_DEPTH_BINDING}) var frontDepth:texture_2d_array<f32>;`,
    ),
  )
  const kernel = front.slice(front.indexOf('fn vsmMarkPagesFromPixels'))
  const marks = kernel.indexOf('vsmMarkTranslucent(svPosition,shiftedPosition,marginSide);')
  assert.ok(marks > 0 && kernel.indexOf('if(!lit){return;}') > marks, 'the surface first')
  assert.ok(kernel.indexOf('textureLoad(normalRough') > kernel.indexOf('if(!lit){return;}'))
  // Every sun's clipmap, the pixel's page dilation, no bias, a point behind the old camera or out of its layer skipped.
  const mark = front.slice(front.indexOf('fn vsmMarkTranslucent'), front.indexOf('@compute'))
  assert.ok(
    mark.includes(
      'vsmMarkPageDirectional(vsmHandleFromId(vsmDirectionalLightIds[index]),position,hasMargin,marginOffset,0.0,-10000);',
    ),
  )
  assert.ok(mark.includes('if(!(previous.w>0.0)){return;}'))
  assert.ok(mark.includes('if(!(frontZ>0.0)){return;}'))
})

test('the marking reads the front layer of the image drawn just before it, and only that', () => {
  const view = {} as GPUTextureView
  const rt = {
    gpu: { targetSize: [64, 32], reflection: { front: { drawn: 0 } } },
    views: { active: {} },
    vis: { gpuHiz: { depth: () => ({ resources: [view] }) } },
    run: { frame: 0 },
    setup: { translucentShadow: { quality: 1 } },
  } as unknown as WebgpuPagesRuntime
  const seen = newFrontSeen(),
    held = newMarkingFront()
  const camera = (x: number) =>
    ({
      viewProjection: Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1]),
      eye: Float64Array.from([10, 0, 0]),
    }) as unknown as EngineCamera
  /** One image drawn: its camera begun, the marking run for it unless `skipped`. */
  const image = (frame: number, x: number, skipped = false) => {
    ;(rt.run as { frame: number }).frame = frame
    const cam = camera(x)
    beginCamera(rt, cam)
    return skipped ? undefined : markingFrontLayer(rt, cam, seen, held)
  }
  const frontPass = (frame: number) =>
    void ((rt.gpu.reflection!.front as { drawn: number }).drawn = frame)
  // The first image has no image before it; its front pass draws.
  assert.equal(image(5, 1), undefined)
  frontPass(5)
  // The next one reads that layer, with the camera of the image that drew it, at that eye.
  assert.equal(image(6, 2), held)
  assert.equal(held.depth, view)
  assert.deepEqual([...held.size], [64, 32])
  assert.equal(held.previousViewProjection[12], 10 + 1)
  // An image that drew no front pass leaves the layer stale: the next reads nothing.
  assert.equal(image(7, 3), undefined)
  // An image drawn between, with no marking, breaks the chain.
  frontPass(7)
  image(8, 4, true)
  assert.equal(image(9, 5), undefined)
  // The project switch at 0 reads none.
  frontPass(9)
  ;(rt.setup as { translucentShadow: { quality: number } }).translucentShadow.quality = 0
  assert.equal(image(10, 6), undefined)
})
