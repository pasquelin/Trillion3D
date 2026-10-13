// The pool's texels page by page (`vsmPoolTexelIndexWgsl`), by its TS mirror: every texel of a
// slice has a word of its own, page k filling [k·16384, (k+1)·16384), at 128 pages a row; each
// texel stays in the window its page row was in (`poolWindowSizes`); and the one accessor — the
// passes' (`vsmBindingsWgsl`) and the forward readers' (`directShadowWgsl`), on a slice of one
// window or split in eight — reads the mirror's word in the mirror's window.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import { functionText } from '../bounce/wgslBody.fixture.ts'
import { vsmBindingsWgsl } from './resources.ts'
import { directShadowWgsl } from '../lighting/direct/shadowWgsl.ts'
import { VSM_LOG2_PAGE, VSM_PAGE_TEXELS } from './constants.ts'
import { poolWindowSizes, VSM_POOL_WINDOW_SHIFT, vsmLayout, type VsmLayout } from './layout.ts'
import { wgslModule } from '../../../math/src/wgsl/assemble.ts'

/** The TS mirror of `vsmPoolTexelIndexWgsl`. */
function vsmPoolTexelIndex(layout: VsmLayout, x: number, y: number) {
  const L = VSM_LOG2_PAGE,
    M = VSM_PAGE_TEXELS - 1
  const page = ((y >>> L) << layout.poolRowShift) | (x >>> L)
  return ((page << (2 * L)) | ((y & M) << L) | (x & M)) >>> 0
}

const PAGE_WORDS = VSM_PAGE_TEXELS * VSM_PAGE_TEXELS
/** Layouts of 128 pages a row, 4, 8 and 16 rows — the engine's — then 128 rows, eight windows. */
const LAYOUTS = [512, 1024, 2048, 16384].map((poolPages) =>
  vsmLayout({ fullMapCapacity: 7, poolPages }),
)

test('every texel of a slice has a word of its own, page k filling [k·16384, (k+1)·16384)', () => {
  assert.deepEqual(
    LAYOUTS.map((l) => [l.poolPagesXY[0], poolWindowSizes(l).length]),
    [
      [128, 1],
      [128, 1],
      [128, 1],
      [128, 8],
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

test('a texel stays in the window its page row was in, every window but the last whole', () => {
  for (const layout of LAYOUTS) {
    const width = layout.poolTexelsXY[0],
      sizes = poolWindowSizes(layout)
    for (let y = 0; y < layout.poolTexelsXY[1]; y += 3)
      for (let x = 0; x < width; x += 5) {
        const word = vsmPoolTexelIndex(layout, x, y),
          window = word >>> VSM_POOL_WINDOW_SHIFT
        assert.equal(window, (y * width + x) >>> VSM_POOL_WINDOW_SHIFT, `(${x}, ${y})`)
        assert.ok(4 * (word - window * 2 ** VSM_POOL_WINDOW_SHIFT) < sizes[window])
      }
  }
})

/** The window an accessor's switch reads at case k, from its text: \`[slice, window]\`. */
function casesOf(text: string) {
  return [...text.matchAll(/case (\d+)u:\{return vsmPool(\d+)_(\d+)\[i\];\}/g)].map((m) => [
    Number(m[1]),
    Number(m[2]),
    Number(m[3]),
  ])
}

test('the passes and the forward readers read the mirror’s word in its window', () => {
  const forward = functionText(wgslModule(directShadowWgsl(20)), 'vsmPoolLoad')
  for (const layout of LAYOUTS) {
    const windows = poolWindowSizes(layout).length
    const specs = [{ resource: 'pagePool', binding: 0, access: 'read_write' }] as const
    const passes = vsmBindingsWgsl(0, specs, layout)
    const load = functionText(passes, 'vsmPoolLoad')
    // The case a texel takes is its slice's windows, then its own: case k reads slice ⌊k / W⌋'s
    // window k mod W, every one once.
    assert.deepEqual(
      casesOf(load),
      Array.from({ length: 2 * windows }, (_, k) => [k, Math.floor(k / windows), k % windows]),
    )
    assert.match(
      load,
      windows === 1
        ? /let i=vsmPoolTexelIndex\(t\);\n switch\(slice\)\{/
        : new RegExp(
            `let l=vsmPoolTexelIndex\\(t\\);\\n let i=l&${2 ** VSM_POOL_WINDOW_SHIFT - 1}u;\\n switch\\(slice\\*${windows}u\\+\\(l>>${VSM_POOL_WINDOW_SHIFT}u\\)\\)\\{`,
          ),
    )
    // A forward reader reads the first slice as the passes do, its one window at the word itself.
    if (windows === 1) assert.equal(forward, load.replace(/\n case 1u:\{[^\n]*\}/, ''))
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
