// The pool's texels page by page (`vsmPoolTexelIndexWgsl`), by its TS mirror: every texel of a
// slice has a word of its own, page k filling [k·16384, (k+1)·16384), at 128 pages a row, in the
// one buffer a slice is (`poolSliceBytes`); and the one accessor — the passes'
// (`vsmBindingsWgsl`) and the forward readers' (`directShadowWgsl`) — reads the mirror's word in
// the buffer of its slice.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { functionsOf } from '../../../materials/texture/shaderRule.fixture.ts'
import {
  createVsmResources,
  vsmBindGroupEntries,
  vsmBindGroupLayoutEntries,
  vsmBindingsWgsl,
} from './resources.ts'
import { directShadowWgsl } from '../../direct/shadowWgsl.ts'
import { VSM_LOG2_PAGE, VSM_PAGE_TEXELS } from './constants.ts'
import { vsmLayout, type VsmLayout } from './layout.ts'
import { poolSliceBytes } from './layoutBytes.ts'
import { wgslModule } from '../../../../../math/src/wgsl/assemble.ts'
import { fakeDevice } from '../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { limitOf, stageBindingCounts } from '../../../../../../tests/kit/fakeDevice/limitRules.ts'

/** The TS mirror of `vsmPoolTexelIndexWgsl`. */
function vsmPoolTexelIndex(layout: VsmLayout, x: number, y: number) {
  const L = VSM_LOG2_PAGE,
    M = VSM_PAGE_TEXELS - 1
  const page = ((y >>> L) << layout.poolRowShift) | (x >>> L)
  return ((page << (2 * L)) | ((y & M) << L) | (x & M)) >>> 0
}

const PAGE_WORDS = VSM_PAGE_TEXELS * VSM_PAGE_TEXELS
/** Layouts of 128 pages a row, 4, 8, 16, 32 and 64 rows — the engine's levels. */
const LAYOUTS = [512, 1024, 2048, 4096, 8192].map((poolPages) =>
  vsmLayout({ fullMapCapacity: 7, poolPages }),
)

test('every texel of a slice has a word of its own, page k filling [k·16384, (k+1)·16384)', () => {
  assert.deepEqual(
    LAYOUTS.map((l) => [l.poolPagesXY[0], poolSliceBytes(l) / 2 ** 20]),
    [
      [128, 32],
      [128, 64],
      [128, 128],
      [128, 256],
      [128, 512],
    ],
  )
  for (const layout of LAYOUTS.slice(0, 2)) {
    const [width, height] = layout.poolTexelsXY,
      seen = new Uint8Array(width * height)
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const word = vsmPoolTexelIndex(layout, x, y),
          page = (y >> 7) * layout.poolPagesXY[0] + (x >> 7)
        assert.ok(word >= page * PAGE_WORDS && word < (page + 1) * PAGE_WORDS, `(${x}, ${y})`)
        assert.equal(seen[word]++, 0, `(${x}, ${y}) shares word ${word}`)
      }
    assert.ok(seen.every((n) => n === 1))
  }
})

test('the words of the largest slice stay in its one buffer', () => {
  const layout = LAYOUTS[LAYOUTS.length - 1],
    [width, height] = layout.poolTexelsXY
  assert.equal(vsmPoolTexelIndex(layout, width - 1, height - 1), poolSliceBytes(layout) / 4 - 1)
})

/** The slice an accessor's switch reads at case k, from its text. */
const casesOf = (text: string) =>
  [...text.matchAll(/case (\d+)u:\{return vsmPool(\d+)\[i\];\}/g)].map((m) => [
    Number(m[1]),
    Number(m[2]),
  ])

test('the passes and the forward readers read the mirror’s word in its slice', () => {
  const forward = functionsOf(wgslModule(directShadowWgsl()), ['vsmPoolLoad'])
  for (const layout of LAYOUTS) {
    const specs = [{ resource: 'pagePool', binding: 0, access: 'read_write' }] as const
    const passes = vsmBindingsWgsl(0, specs, layout)
    const load = functionsOf(passes, ['vsmPoolLoad'])
    // Case k reads slice k's buffer, every slice once, at the texel's word.
    assert.deepEqual(casesOf(load), [
      [0, 0],
      [1, 1],
    ])
    assert.match(load, /let i=vsmPoolTexelIndex\(t\);\n switch\(slice\)\{/)
    // A forward reader reads the first slice as the passes do.
    assert.equal(forward, load.replace(/\n case 1u:\{[^\n]*\}/, ''))
    const words = shaderRun<{ vsmPoolTexelIndex: (t: number[]) => number }>(
      passes,
      ['vsmPoolTexelIndex'],
      {},
    ).vsmPoolTexelIndex
    const [width, height] = layout.poolTexelsXY
    for (let k = 0; k < 20000; k++) {
      const x = k < 4 ? [0, 127, 128, width - 1][k] : (k * 7919) % width,
        y = k < 4 ? [0, 127, 128, height - 1][k] : (k * 104729) % height
      assert.equal(words([x, y]), vsmPoolTexelIndex(layout, x, y), `(${x}, ${y})`)
    }
  }
})

test('the pool binds one storage buffer a slice at every level, within the default stage limits', () => {
  // A forward reader — the blends, whose fragment stage holds the eight storage buffers — reads the
  // first slice in one binding, the passes of the shadows bind both slices, two: a pool past a
  // device's binding is a smaller pool (`vsmPoolPagesBound`), never a second binding.
  const forward = [{ resource: 'pagePool', binding: 0, slices: 1 }] as const
  const passes = [{ resource: 'pagePool', binding: 0, access: 'read_write' }] as const
  for (const poolPages of [512, 2048, 4096, 8192]) {
    const res = createVsmResources(fakeDevice().device, { fullMapCapacity: 7, poolPages })
    for (const [specs, bound] of [
      [forward, 1],
      [passes, 2],
    ] as const) {
      assert.equal(vsmBindGroupEntries(res, specs).length, bound, `${poolPages} pages`)
      const entries = vsmBindGroupLayoutEntries(specs, GPUShaderStage.COMPUTE)
      assert.equal(entries.length, bound)
      for (const { limit, count } of stageBindingCounts({
        bindGroupLayouts: [{ entries }] as never,
      }))
        assert.ok(count <= limitOf(limit), `${poolPages} pages: ${count} ${limit}`)
    }
    res.destroy()
  }
})
