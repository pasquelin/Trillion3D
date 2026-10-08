// #748: the card's chains pick `t` and scale as the compiler does. The shipped WGSL is run here
// (`shaderRule.fixture.ts`), on the table the compiler's test reads too
// (`texture_preview/tests/coverage_alpha.rs`): one expected answer for every builder.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { COVERAGE_PICK_WGSL, COVERAGE_SCALE_WGSL } from './coverageRule.ts'
import { CoverageReaders } from './coverage.ts'
import type { PageSurface } from '../page/surface.ts'
import type { Texture } from '../../../sdk-core/src/index.ts'
import { shaderFunctions, vec } from './shaderRule.fixture.ts'
import { cutoffByte } from './cutoffByte.ts'
import { wgslSource } from '../../../math/src/wgsl/source.fixture.ts'

const NAMES = ['scaled', 'wideProduct', 'pickKey', 'below', 'apart']

const table = JSON.parse(
  readFileSync(
    new URL('../../../../tests/fixtures/formats/previews/coverage-alpha.json', import.meta.url),
    'utf8',
  ),
) as { cases: string[] }

type Vec = ReturnType<typeof vec>
type Rule = {
  scaled(a: number, c: number, t: number): number
  wideProduct(a: number, b: number): Vec
  pickKey(c: number, t: number, above: number, texels: Vec, goal: Vec): Vec
  below(a: Vec, b: Vec): boolean
}

/** The pick of `t` over `histogram`: the least key of the bytes 255 to 1, the one the choose
 *  kernel's lanes reduce to (`COVERAGE_CHOOSE_WGSL`). */
function pickOf(rule: Rule, histogram: number[], c: number, covered: number, texels: Vec) {
  const goal = rule.wideProduct(covered, texels.y)
  let above = 0,
    best: Vec | undefined
  for (let t = 255; t > 0; t--) {
    above = (above + histogram[t]) >>> 0
    const key = rule.pickKey(c, t, above, texels, goal)
    if (!best || rule.below(key, best)) best = key
  }
  return best!.w
}

test("the WGSL pick of t and scale are the compiler's, on its table", () => {
  const rule = shaderFunctions<Rule>(
    wgslSource(COVERAGE_SCALE_WGSL) + wgslSource(COVERAGE_PICK_WGSL),
    NAMES,
  )
  for (const row of table.cases) {
    const [[cutoff], level0, level, [t], scaled] = row
      .split('|')
      .map((part) => part.trim().split(' ').map(Number))
    const histogram = Array.from(
      { length: 256 },
      (_, byte) => level.filter((a) => a === byte).length,
    )
    const covered = level0.filter((a) => a >= cutoff).length
    const picked = pickOf(rule, histogram, cutoff, covered, vec(level0.length, level.length))
    assert.equal(picked, t, row)
    assert.deepEqual(
      level.map((a) => rule.scaled(a, cutoff, t)),
      scaled,
      row,
    )
  }
  // Products past 32 bits: a 16384² level 0 against its level 1.
  for (const [a, b] of [
    [16384 ** 2, 8192 ** 2 - 3],
    [0xffffffff, 0xffffffff],
    [65536, 65535],
  ]) {
    const { x, y } = rule.wideProduct(a, b)
    assert.equal((BigInt(x) << 32n) | BigInt(y), BigInt(a) * BigInt(b), `${a} × ${b}`)
  }
})

// #44's `cutoff_byte`, the product the engine cuts, and a texture cut at the lowest cutoff of its
// masked readers, not at all once one of them blends or its chain does not weigh by alpha.
test('a chain is cut at its readers’ lowest cutoff byte, 0 once one blends', () => {
  assert.deepEqual(
    [0.5, 0.25, 1 / 255, 1].map((cutoff) => cutoffByte(cutoff, 1)),
    [128, 64, 1, 255],
  )
  // 0.66 / 0.9 × 255 is 187 on the dot, which the product keeps and the quotient rounds to 188.
  assert.deepEqual(
    [cutoffByte(0.66, 0.9), cutoffByte(0.5, 0), cutoffByte(0.5, 0.25)],
    [187, 255, 255],
  )
  const map = { premultiplyAlpha: false } as Texture,
    readers = new CoverageReaders()
  const surface = (alphaTest: number, transparent = false, opacity = 1) =>
    readers.read({
      map,
      alphaTest,
      transparent,
      opacity,
      blending: 'normal',
      transmission: 0,
    } as PageSurface)
  surface(0.5)
  surface(0.25, false, 0.5)
  assert.equal(readers.cutoff(map), 128, '0.25 under a factor of 0.5 cuts at 0.5')
  surface(0.25)
  assert.equal(readers.cutoff(map), 64)
  surface(0, true)
  assert.equal(readers.cutoff(map), 0, 'a blended reader: the median alone')
  surface(0)
  assert.equal(readers.cutoff(map), undefined, 'an opaque reader: the plain chain')
})
