// The page marking is one compute pass (`vsmEncode.ts` opens it): the physical page address update
// first, then the marking's clears, page rects, coarse pages and pixels (`markingPass.ts`), each
// dispatch seeing the writes of those before it — the order the separate passes kept. The tables
// every map's pages clear are cleared in one walk of them (`vsmResetPageTableWgsl`): each table at
// the texels, mips and stride its own kernel cleared, so the tables hold what the four clears left.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts'
import { createVsmMarking } from './markingPass.ts'
import { vsmMarkingClears, vsmResetPageTableWgsl, type VsmClearTarget } from './markingWgsl.ts'
import { createVsmResources } from './resources.ts'
import { vsmLayout } from './layout.ts'

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
  const layout = vsmLayout({ fullMapCapacity: 63, sunMapCapacity: 18 }, 2 ** 27)
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
  const at = (receiver: 'local' | 'directional' | 'none') =>
    vsmMarkingClears({ ...vsmLayout({ fullMapCapacity: 7 }, 2 ** 27), coverMode: receiver })
  assert.deepEqual(at('local'), { all: TARGETS, directionalOnly: [] })
  assert.deepEqual(at('directional'), {
    all: TARGETS.slice(0, 3),
    directionalOnly: ['receiverCover'],
  })
  assert.deepEqual(at('none'), { all: TARGETS.slice(0, 3), directionalOnly: [] })
})

test('the marking records into the pass it is given: its clears, rects and coarse pages in order', () => {
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
  marking.encode(pass, {
    fullMapCount: 1,
    singlePageMapCount: 0,
    perPage: {
      ids: new Uint32Array(2),
      all: [bin, none, none, none],
      directionalOnly: [bin, none, none, none],
    },
  })
  const clears = vsmMarkingClears(res.layout)
  assert.deepEqual(steps, [
    ...['vsmClearPageTables', 'dispatch'],
    ...(clears.directionalOnly.length ? ['vsmClearPageTables', 'dispatch'] : []),
    ...['vsmInitPageRects', 'dispatch', 'vsmMarkCoarse', 'dispatch'],
  ])
})

test('the frame opens the marking pass: the dirty flags cleared before it, the address update first', () => {
  const encode = readFileSync(
    new URL('../webgpu/pages/render/vsm/vsmEncode.ts', import.meta.url),
    'utf8',
  )
  const at = (text: string) => encode.indexOf(text)
  const order = [
    'encoder.clearBuffer(res.rasterMarks);',
    'const marking = encoder.beginComputePass(MARKING_PASS);',
    'encodeVsmPageCarry(marking, res, pmFrame);',
    'vsm.marking.encode(marking, markingFrame);',
    'marking.end();',
    'encodeVsmPageMapping(encoder, res, pmFrame);',
  ].map(at)
  assert.ok(
    order.every((k, i) => k > 0 && (i === 0 || k > order[i - 1])),
    `${order}`,
  )
})
