// What a cut reads of a placement it makes where it reads it (`primitiveWgsl.ts`): a placement's
// record is its host words and its pose, 128 bytes at most whatever the placements, and no kernel
// derives anything into it — so a placement the descent never visits costs nothing. The GPU run
// against the uncached form is `tests/gpu/dag/prepare.gpu.ts`; here, the bytes, the sites that read
// the thread's pose, and the one verdict that has a form of its own — a never-culled primitive's
// open planes — on every box.
import test from 'node:test'
import assert from 'node:assert/strict'
import { DAG_SELECTION_SHADER } from './shader.ts'
import { DAG_CONE_WGSL } from './coneWgsl.ts'
import { DAG_PRIMITIVE_WGSL } from './primitiveWgsl.ts'
import { FRAME_VEC4 } from '../types.ts'
import { createDagResources } from '../resources.ts'
import { packDagSelection } from '../selection.ts'
import { packed } from '../selectionHelpers.fixture.ts'
import { dagFixture } from '../../../page/selection/dag.fixture.ts'
import { fakeDevice } from '../../../../../../tests/kit/gpu/fakeDevice.ts'
import { lcgRandom } from '../../../../../math/src/sequence/random.ts'
import { frustumExcludesBox } from '../../../../../sdk-core/src/index.ts'
import { wgslSource } from '../../../../../math/src/wgsl/source.fixture.ts'
import { encodeDagKernels } from '../encode.ts'
import { cutResources, witnessEncoder } from '../encode.fixture.ts'
import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'

test('a placement holds 128 bytes at most, whatever the placements', async () => {
  const [root] = packed(dagFixture()).roots
  for (const count of [1, 100, 5000]) {
    const dag = packDagSelection(Array.from({ length: count }, () => root))
    const resources = (await createDagResources(fakeDevice().device, dag))!
    const { buffers, worldBuffers } = resources.frames
    const bytes = [...buffers, ...worldBuffers].reduce((sum, buffer) => sum + buffer.size, 0)
    assert.ok(
      bytes / dag.worldCount <= 128,
      `${count} placements: ${bytes / dag.worldCount} B each`,
    )
  }
  assert.equal(FRAME_VEC4, 2, 'its words, two vec4s: no block derived beside them')
})

test('the frame’s prepare reads no placement: ten thousand cost it what their tree’s top does', () => {
  const [root] = packed(dagFixture()).roots
  const count = 10_000,
    dag = packDagSelection(Array.from({ length: count }, () => root))
  const top = dag.placementTree!.levels[0].count,
    blockCount = ceilDiv(dag.pageCount, 64)
  const { encoder, dispatches } = witnessEncoder()
  const cut = {
    ...cutResources(3),
    packed: dag,
    blockCount,
    ranges: [{ first: 0, count, bindGroup: {} }],
  } as unknown as Parameters<typeof encodeDagKernels>[1]
  encodeDagKernels(encoder as unknown as GPUCommandEncoder, cut)
  const prepare = dispatches.find((d) => d.kernel === 'dagPrepare')!,
    groups = Number(prepare.groups) * (prepare.rows ?? 1)
  // The tree's top nodes and the block counts it resets, never a thread a placement.
  assert.equal(groups, ceilDiv(Math.max(top, blockCount), 64))
  assert.ok(64 * groups < count / 4, `${groups} groups`)
})

test('no kernel writes a placement’s row: its pose is made where it is read', () => {
  assert.doesNotMatch(
    DAG_SELECTION_SHADER,
    /\bframes\[[^\]]*\]\s*=[^=]/,
    'a kernel writes `frames`',
  )
  // Made once per thread, from the pose at the eye (`placed`): every read goes through it.
  const text = wgslSource(DAG_PRIMITIVE_WGSL)
  assert.equal(text.match(/worldPose\(/g)?.length, 1, 'one pose a thread')
  for (const read of ['viewWorld', 'normalOf', 'conformalOf', 'preparedPose', 'planeOf']) {
    const body = text.slice(text.indexOf(`fn ${read}(`))
    assert.ok(
      body.slice(0, body.indexOf('\n')).includes('placed(w)') || body.includes(' placed(w);'),
    )
  }
  const box = wgslSource(DAG_CONE_WGSL).slice(
    wgslSource(DAG_CONE_WGSL).indexOf('fn coneRejectsBox'),
  )
  assert.ok(box.includes('conformalOf(w)') && box.includes('invTranspose3Apply(normalOf(w),'))
  assert.match(
    DAG_SELECTION_SHADER,
    /fn outsideAhead\([^)]*\)->bool\{return outsideFrustum\(w,AHEAD_VIEW,/,
  )
})

test("a never-culled primitive's open planes keep every box", () => {
  const open = new Float64Array(24)
  for (let p = 0; p < 6; p++) open[p * 4 + 3] = 1
  const next = lcgRandom(9),
    edges = [NaN, -Infinity, -3.4e38, -1, -0, 0, 1, 3.4e38, Infinity]
  const values = [...edges, ...Array.from({ length: 40 }, () => (next() - 0.5) * 1e6)]
  for (let n = 0; n < 20_000; n++) {
    const pick = () => values[Math.floor(next() * values.length)]
    const box = [pick(), pick(), pick(), pick(), pick(), pick()] as const
    assert.equal(frustumExcludesBox(open, ...box), false, box.join(', '))
  }
  assert.ok(DAG_SELECTION_SHADER.includes(',vec4f(0.0,0.0,0.0,1.0),unculledOf(w));'))
})

test('a deadline ahead reads the camera planes, though the view ahead is the current view', () => {
  // `wantAhead` sets `vi` to the view ahead before `aheadDue`: its camera planes are view 0's.
  const due = DAG_SELECTION_SHADER.slice(DAG_SELECTION_SHADER.indexOf('fn aheadDue('))
  const body = due.slice(0, due.indexOf('\n}'))
  assert.ok(body.includes('planeReach(planeOf(w,0u,i),'), 'the camera plane, view 0')
  assert.ok(body.includes('planeReach(planeOf(w,AHEAD_VIEW,i),'), 'the plane ahead')
})
