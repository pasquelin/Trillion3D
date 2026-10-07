// What a camera cut's `dagPrepare` derives once per primitive (`primitiveWgsl.ts`): the same
// expressions the visited nodes and pages computed, read back where they computed them. The GPU
// run against the per-site form is `tests/gpu/dag/prepare.gpu.ts`; here, the layout that
// holds them, the sites that read them, and the one verdict that changed form — a never-culled
// primitive's planes ahead — on every box.
import test from 'node:test'
import assert from 'node:assert/strict'
import { DAG_SELECTION_SHADER } from './shader.ts'
import { DAG_CONE_WGSL } from './coneWgsl.ts'
import { DAG_PRIMITIVE_WGSL } from './primitiveWgsl.ts'
import { FRAME_VEC4, PRIMITIVE_VEC4 } from '../types.ts'
import { primitiveFrameWords } from '../worlds.ts'
import { framesBytes } from '../frameRanges.ts'
import { wgslScope } from '../../../page/cut/wgslPredicate.fixture.ts'
import { wgslConstants } from '../../../texture/shaderRule.fixture.ts'
import { random } from '../../../page/cut/cutRuleChecks.fixture.ts'
import { frustumExcludesBox } from '../../../../../sdk-core/src/index.ts'
import { wgslSource } from '../../../../../math/src/wgsl/source.fixture.ts'

const packed = (worldCount: number) => ({
  worldCount,
  worldStretch: new Float32Array(worldCount).fill(1),
  rootNodes: new Uint32Array(worldCount),
  recordShift: new Uint32Array(worldCount),
})

test("each primitive's values fill its share, behind the row the host writes", () => {
  const c = wgslConstants(DAG_SELECTION_SHADER)
  const parts = [
    [c.CAMERA_E, 4],
    [c.AHEAD_E, 4],
    [c.NORMAL, 3],
    [c.AHEAD_PLANES, 6],
  ].sort((a, b) => a[0] - b[0])
  let at = 0
  for (const [offset, size] of parts) {
    assert.equal(offset, at, 'no gap, no overlap')
    at += size
  }
  assert.equal(at, PRIMITIVE_VEC4)
  assert.equal(c.PRIMITIVE, PRIMITIVE_VEC4)
  assert.equal(c.FRAME, FRAME_VEC4)
  for (const worldCount of [1, 3, 1000]) {
    const scope = { ...c, rangeCount: () => worldCount, rangeFirst: () => 0 }
    const base = wgslScope(DAG_SELECTION_SHADER, scope).fn('primitiveBase')
    const frames = primitiveFrameWords(packed(worldCount))
    assert.equal(frames.length, worldCount * FRAME_VEC4 * 4, 'the host writes its row alone')
    assert.equal(base(0), worldCount * FRAME_VEC4, 'behind the first row')
    assert.equal(((base(worldCount - 1) as number) + PRIMITIVE_VEC4) * 16, framesBytes(worldCount))
  }
})

test('one primitive holds its row and its prepared values', () => {
  assert.equal(framesBytes(1), (FRAME_VEC4 + PRIMITIVE_VEC4) * 16)
})

test('camera sites read their prepared values', () => {
  assert.ok(!wgslSource(DAG_PRIMITIVE_WGSL).includes('views[vi].view*'))
  const box = wgslSource(DAG_CONE_WGSL).slice(
    wgslSource(DAG_CONE_WGSL).indexOf('fn coneRejectsBox'),
  )
  assert.ok(!box.includes('isConformal(') && !box.includes('inverseTranspose3('))
  assert.ok(box.includes('conformalOf(w)') && box.includes('invTranspose3Apply(normalOf(w),'))
  assert.match(
    DAG_SELECTION_SHADER,
    /fn outsideAhead\([^)]*\)->bool\{return outsideFrustum\(aheadPlanes\(w\),/,
  )
  assert.ok(
    DAG_SELECTION_SHADER.includes('putPlanes(base,m,vi,open);preparePrimitive(w,pose,m,open);'),
  )
})

test("a never-culled primitive's open planes ahead keep every box, as its early exit did", () => {
  const open = new Float64Array(24)
  for (let p = 0; p < 6; p++) open[p * 4 + 3] = 1
  const next = random(9),
    edges = [NaN, -Infinity, -3.4e38, -1, -0, 0, 1, 3.4e38, Infinity]
  const values = [...edges, ...Array.from({ length: 40 }, () => (next() - 0.5) * 1e6)]
  for (let n = 0; n < 20_000; n++) {
    const pick = () => values[Math.floor(next() * values.length)]
    const box = [pick(), pick(), pick(), pick(), pick(), pick()] as const
    assert.equal(frustumExcludesBox(open, ...box), false, box.join(', '))
  }
})

test('a deadline ahead reads the camera planes, though the view ahead is the current view', () => {
  // `wantAhead` sets `vi` to the view ahead before `aheadDue`: its camera planes are the row's under
  // view 0, never `slotOf` under view 1, which lands in the primitives' prepared values.
  const c = wgslConstants(DAG_SELECTION_SHADER)
  const now = /fn aheadDue[^]*?let now=([^;]+);/.exec(DAG_SELECTION_SHADER)![1]
  for (const worldCount of [1, 3, 1000]) {
    const host = { ...c, rangeCount: () => worldCount, rangeFirst: () => 0 }
    const slot = wgslScope(DAG_SELECTION_SHADER, { ...host, vi: 0 }).fn('slotOf')
    const base = wgslScope(DAG_SELECTION_SHADER, host).fn('primitiveBase')
    const read = wgslScope(DAG_SELECTION_SHADER, { ...host, vi: c.AHEAD_VIEW }).expression(now, [
      'w',
    ])
    for (const w of [0, worldCount - 1]) {
      assert.equal(read({ w }), (slot(w) as number) * c.FRAME, `primitive ${w} of ${worldCount}`)
      assert.ok((read({ w }) as number) < (base(0) as number), 'within the rows')
    }
  }
})
