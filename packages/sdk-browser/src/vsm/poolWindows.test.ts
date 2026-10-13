// A reader outside the VSM passes reads every texel of the pool's first slice through its windows,
// whatever parts the device's binding size split the slice into: each texel's window, at the
// window's offset, addresses the very word the passes' own part addressing does (`buildPool`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { vsmPoolWindow } from './poolWindows.ts'
import { poolPartSizes, vsmLayout } from './layout.ts'
import { VSM_LOG2_PAGE, VSM_PAGE_TEXELS } from './constants.ts'
import { BLEND_VSM_BINDINGS } from '../webgpu/core/bindLayout.ts'
import { CONTRACT_VSM_BINDINGS } from '../lighting/direct/shadowWgsl.ts'

/** The pool word of texel (x, y), page by page (`vsmPoolTexelIndexWgsl`). */
const texelIndex = (x: number, y: number, rowShift: number) => {
  const L = VSM_LOG2_PAGE,
    M = VSM_PAGE_TEXELS - 1
  return (((((y >> L) << rowShift) | (x >> L)) << (2 * L)) | ((y & M) << L) | (x & M)) >>> 0
}

test('every texel of a split slice is read at the word its part holds', () => {
  // A device whose binding holds two page rows (16 MiB): the 2048-page slice in eight parts. The
  // windows hold one row each, a part two of them.
  const layout = vsmLayout({ fullMapCapacity: 0, poolPages: 2048 }, 2 ** 24)
  assert.ok(layout.poolPartsPerSlice > 1, 'the slice is split')
  const parts = poolPartSizes(layout).map((size, part) => ({ size, part }))
  const res = { layout, pagePool: [parts, parts] } as unknown as Parameters<typeof vsmPoolWindow>[0]
  const windowBytes = 2 ** 23,
    windowShift = Math.log2(windowBytes / 4)
  const [w, h] = layout.poolTexelsXY
  let read = 0
  for (let y = 0; y < h; y += 61)
    for (let x = 0; x < w; x += 127) {
      const l = texelIndex(x, y, layout.poolRowShift)
      const window = vsmPoolWindow(res, l >>> windowShift, windowBytes)!
      const word = (l & (2 ** windowShift - 1)) >>> 0
      assert.ok(4 * word < window.size!, 'inside its window')
      const part = l >>> layout.poolPartTexelShift
      assert.equal(window.buffer, parts[part] as unknown as GPUBuffer, `texel ${x} ${y}`)
      assert.equal(
        window.offset! + 4 * word,
        4 * ((l & (2 ** layout.poolPartTexelShift - 1)) >>> 0),
      )
      read++
    }
  assert.ok(read > 1000)
  // Past the slice, no window: the stand-in no texel reads.
  assert.equal(vsmPoolWindow(res, (w * h * 4) / windowBytes, windowBytes), undefined)
})

test("the engine's largest pool spans the windows the forward passes bind", () => {
  // At WebGPU's guaranteed binding size the engine's pool is one window: the blends and the water
  // bind exactly that many, the window holding the whole slice on every device.
  assert.equal(BLEND_VSM_BINDINGS.pool.length, 1)
  assert.equal(CONTRACT_VSM_BINDINGS.pool.length, 1)
  const layout = vsmLayout({ fullMapCapacity: 0, poolPages: 2048 }, 2 ** 31)
  const part = { size: poolPartSizes(layout)[0] }
  const window = vsmPoolWindow({ layout, pagePool: [[part], [part]] } as never, 0)!
  assert.deepEqual(window, { buffer: part, offset: 0, size: 2 ** 27 })
})
