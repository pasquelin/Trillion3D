// The translucent surfaces' mark of the radiance cache (`pool/translucentMark.ts`) run as JavaScript: the level a fragment marks with the
// mark's own fade, the test against the opaque surfaces, and the bindings of the program that binds it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { createBounceCascades } from '../../../../../sdk-core/src/bounce/cascades.ts'
import { assertProgramAssembles } from '../../../gpu/core/wgslNames.fixture.ts'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { markedCells } from './pool.fixture.ts'
import { poolShapeOf } from './poolLayout.ts'
import {
  TRANSLUCENT_MARK_BINDINGS,
  TRANSLUCENT_MARK_PARAMS,
  translucentMark,
  translucentMarkTarget,
} from './translucentMark.ts'

const PROGRAM = wgslProgram(
  `fn markAt(position:vec2f,P:vec3f){markTranslucent(position,P);}
fn uvAt(position:vec2f)->vec2f{return translucentMarkUv(position);}
fn hiddenAt(viewDepth:f32,farthest:f32)->bool{return translucentMarkHidden(viewDepth,farthest);}`,
  [translucentMark(0)],
)

/** The interleaved gradient noise of a pixel at a frame, in double precision. */
const noise = ([x, y]: number[], frame: number) => {
  const dot = (x + frame * 47 * 0.695) * 0.06711056 + (y + frame * 17 * 0.695) * 0.00583715
  const fract = (v: number) => v - Math.floor(v)
  return fract(52.9829189 * fract(dot))
}

/** The levels centred on the eye `[5, 5, 5]`, and the program run over them with the mark's parameters. */
function run(params: { invFade: number; hizTest: number; size?: number[] }) {
  const cascades = createBounceCascades([0, 0, 0, 10, 10, 10])
  cascades.follow([5, 5, 5])
  const bounce = {
    counts: [cascades.size, cascades.levels.length, cascades.cells, cascades.probes],
    frame: [1, 0, 3, 0],
    eye: [5, 5, 5, 0],
    levels: cascades.levels.map(({ base, spacing }) => ({ base: [...base], spacing })),
  }
  const marks = new Uint32Array(poolShapeOf(cascades).markWords)
  const translucent = { size: [4, 6], hizMip: 1, ...params }
  const fns = shaderRun<{
    markAt: (position: number[], P: number[]) => void
    uvAt: (position: number[]) => number[]
    hiddenAt: (viewDepth: number, farthest: number) => boolean
  }>(PROGRAM, ['markAt', 'uvAt', 'hiddenAt'], { bounce, marks, translucentMark: translucent })
  return { cascades, marks, ...fns }
}

test('a fragment marks the eight probes round its point in the level its dither picks, the level’s edge fading over the mark’s own probes, not the cache’s', () => {
  const { base, spacing } = run({ invFade: 1, hizTest: 1 }).cascades.levels[0]
  // One probe inside the level's first: the cache's own fade (one probe) gives the level its whole share, a fade over four probes a quarter.
  const point = [(base[0] + 1) * spacing, 5, 5]
  const levelOf = (invFade: number, position: number[]) => {
    const { marks, cascades, markAt } = run({ invFade, hizTest: 1 })
    markAt(position, point)
    const cells = markedCells(cascades, marks)
    assert.equal(cells.length, 8)
    assert.equal(new Set(cells.map(({ level }) => level)).size, 1)
    return cells[0].level
  }
  let narrow = 0
  let wide = 0
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const position = [x + 0.5, y + 0.5]
      const dither = noise(position, 3)
      if (Math.abs(dither - 0.25) < 1e-3) continue
      assert.equal(levelOf(1, position), 0, 'the cache’s fade: the level answers whole')
      const level = levelOf(0.25, position)
      assert.equal(level, dither < 0.25 ? 0 : 1, `dither ${dither}`)
      narrow++
      wide += level === 0 ? 1 : 0
    }
  // The coarser level takes the rest: about three fragments in four.
  assert.ok(wide > 0 && wide < narrow, `${wide} of ${narrow}`)
})

test('a fragment behind the opaque surfaces marks nothing where the test runs, and is seen where it does not', () => {
  const tested = (hizTest: number) => run({ invFade: 0.25, hizTest })
  assert.equal(tested(1).hiddenAt(5, 5), true, 'at the farthest depth')
  assert.equal(tested(1).hiddenAt(6, 5), true)
  assert.equal(tested(1).hiddenAt(4.9, 5), false)
  assert.equal(tested(0).hiddenAt(6, 5), false, 'the test off')
})

test('a fragment’s place in the view is its pixel over the downsampled target, the target the view divided by the downsample rounded up', () => {
  assert.deepEqual(run({ invFade: 0.25, hizTest: 1 }).uvAt([2, 3]), [0.5, 0.5])
  assert.deepEqual(translucentMarkTarget([1920, 1080], 4), [480, 270])
  assert.deepEqual(translucentMarkTarget([1001, 603], 4), [251, 151])
  assert.deepEqual(translucentMarkTarget([1920, 1080], 1), [1920, 1080])
})

test('the program binds the parameters, the levels and the bitmap in the group it is given, and nothing else', () => {
  const { size, invFade, hizMip, hizTest } = TRANSLUCENT_MARK_PARAMS.at
  assert.deepEqual([size, invFade, hizMip, hizTest], [0, 2, 3, 4])
  for (const group of [0, 2]) {
    const code = wgslProgram('fn visit(position:vec2f,P:vec3f){markTranslucent(position,P);}', [
      translucentMark(group),
    ])
    assertProgramAssembles(code, undefined, `group ${group}`)
    const declared = [...code.matchAll(/@group\((\d+)\)\s*@binding\((\d+)\)/g)].map((m) => [
      +m[1],
      +m[2],
    ])
    assert.deepEqual(
      declared.sort((a, b) => a[1] - b[1]),
      Object.values(TRANSLUCENT_MARK_BINDINGS)
        .sort((a, b) => a - b)
        .map((binding) => [group, binding]),
    )
  }
})
