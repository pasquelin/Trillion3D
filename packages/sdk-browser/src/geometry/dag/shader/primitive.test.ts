// What a cut reads of a placement it makes where it reads it (`primitiveWgsl.ts`): a placement's
// record is its host words and its pose, 128 bytes at most whatever the placements, and no kernel
// derives anything into it — so a placement the descent never visits costs nothing. The GPU run
// against the uncached form is `tests/gpu/dag/prepare.gpu.ts`; here, the bytes, the sites that read
// the thread's pose, the one verdict that has a form of its own — a never-culled primitive's
// open planes — on every box, and the draw distance a placement's mark gates (`drawDistanceWgsl.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { WORKGROUP_THREADS } from '../../../gpu/dispatch/grid.ts'
import { DAG_SELECTION_SHADER } from './shader.ts'
import { DAG_PRIMITIVE_WGSL } from './primitiveWgsl.ts'
import { DRAW_DISTANCE_MARK, DRAW_FAR_WORD, DRAW_NEAR_WORD, FRAME_TABLE } from '../frameTable.ts'
import { createDagResources } from '../resources.ts'
import { packDagSelection } from '../pack/pack.ts'
import { packed } from '../selection/selectionHelpers.fixture.ts'
import { dagFixture } from '../../selection/dag.fixture.ts'
import { fakeDevice } from '../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { lcgRandom } from '../../../../../math/src/sequence/random.ts'
import { frustumExcludesBox } from '../../../../../math/src/geometry/frustum/box.ts'
import { wgslSource } from '../../../../../math/src/wgsl/source.fixture.ts'
import { encodeDagKernels } from '../encode.ts'
import { cutResources, witnessEncoder } from '../encode.fixture.ts'
import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import { DAG_DRAW_DISTANCE_WGSL } from './drawDistanceWgsl.ts'
import { CULL_DRAW_DISTANCE_OFF } from './viewsWgsl.ts'
import { OCCLUSION_TWO_PASS } from './occlusionWgsl.ts'
import { TREE_DRAW_FAR, TREE_DRAW_NEAR } from '../nodeLayout.ts'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { Mat } from '../../../materials/texture/shaderRunMatrix.fixture.ts'
import { f32Bits } from '../../../../../math/src/float/bits.ts'
import {
  fitDrawDistances,
  outsideDrawDistance,
  outsideGroupDrawDistance,
} from '../oracle/nodeVerdict.fixture.ts'

test('a placement holds 152 bytes at most, whatever the placements, past one row of the records', async () => {
  const [root] = packed(dagFixture()).roots
  // A row of the records holds 1024 placements of 112 bytes — world, exact translation, the proxy's
  // instance (`../worlds/worldTable.ts`) —, a row of the frame words 512 of 40 (`../frameTable.ts`): a
  // world of fewer pays those rows whole, once.
  const row = 1024 * 112 + 512 * 40
  for (const count of [1, 100, 5000]) {
    const dag = packDagSelection(Array.from({ length: count }, () => root))
    const resources = (await createDagResources(fakeDevice().device, dag))!
    const { rows, worlds } = resources.frames
    const bytes = rows.bytes + worlds.bytes
    assert.ok(
      bytes <= 152 * dag.worldCount + row,
      `${count} placements: ${bytes / dag.worldCount} B each`,
    )
  }
  const words = Object.values(FRAME_TABLE.fields).reduce((sum, texels) => sum + texels, 0)
  assert.equal(
    words,
    10,
    'its row, the two draw distances it names and its stretch, ten words: no block derived beside them',
  )
})

test('the frame’s prepare reads no placement: ten thousand cost it what their tree’s top does', () => {
  const [root] = packed(dagFixture()).roots
  const count = 10_000,
    dag = packDagSelection(Array.from({ length: count }, () => root))
  const top = dag.placementTree!.levels[0].count,
    blockCount = ceilDiv(dag.pageCount, WORKGROUP_THREADS)
  const witness = witnessEncoder()
  const cut = {
    ...cutResources(3),
    packed: dag,
    blockCount,
    worldCount: count,
  } as unknown as Parameters<typeof encodeDagKernels>[1]
  encodeDagKernels(witness.encoder, cut)
  const { dispatches } = witness.read()
  const prepare = dispatches.find((d) => d.kernel === 'dagPrepare')!,
    groups = Number(prepare.groups) * (prepare.rows ?? 1)
  // The tree's top nodes and the block counts it resets, never a thread a placement.
  assert.equal(groups, ceilDiv(Math.max(top, blockCount), WORKGROUP_THREADS))
  assert.ok(WORKGROUP_THREADS * groups < count / 4, `${groups} groups`)
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
  for (const read of ['viewWorld', 'preparedPose', 'placedPlane']) {
    const body = text.slice(text.indexOf(`fn ${read}(`))
    assert.ok(
      body.slice(0, body.indexOf('\n')).includes('placed(w)') || body.includes(' placed(w);'),
    )
  }
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

test('a placement is out of the distances it names nearer than its nearest or past its farthest, both ends drawn', () => {
  const at = (z: number) => [0, 0, z]
  assert.equal(outsideDrawDistance(10, 100, at(50)), false)
  assert.equal(outsideDrawDistance(10, 100, at(5)), true, 'nearer than its nearest')
  assert.equal(outsideDrawDistance(10, 100, at(101)), true, 'past its farthest')
  assert.equal(outsideDrawDistance(10, 100, at(100)), false)
  assert.equal(outsideDrawDistance(10, 100, [-6, 0, -8]), false, 'the distance, not an axis')
  // A farthest of 0 names none: the nearest alone culls nothing.
  assert.equal(outsideDrawDistance(10, 0, at(5)), false)
  assert.equal(outsideDrawDistance(0, 0, at(1e9)), false)
  // The view's scale multiplies both distances before they are squared.
  assert.equal(outsideDrawDistance(10, 100, at(15), 2), true, 'its nearest is 20 there')
  assert.equal(outsideDrawDistance(10, 100, at(150), 2), false, 'its farthest is 200 there')
  assert.equal(outsideDrawDistance(10, 100, at(60), 0.5), true, 'its farthest is 50 there')
  assert.equal(outsideDrawDistance(10, 100, at(1), 0), true, 'a scale of 0 draws only the eye')
})

test('a group is out only where no placement can be drawn: its distances are its placements’', () => {
  const none = { near: 0, far: 0 }
  const named = [
    { near: 5, far: 50 },
    { near: 2, far: 80 },
    { near: 9, far: 60 },
  ]
  assert.deepEqual(fitDrawDistances(named), { near: 2, far: 80 })
  // One placement drawn at every distance makes the group's none, and so does a group with none.
  assert.deepEqual(fitDrawDistances([...named, { near: 3, far: 0 }]), none)
  assert.deepEqual(fitDrawDistances([]), none)
  const next = lcgRandom(7)
  let culled = 0,
    kept = 0
  for (let n = 0; n < 4000; n++) {
    // Placements at points of a box, each with its own distances, one in four with none.
    const centre = [0, 1, 2].map(() => (next() - 0.5) * 400),
      half = [0, 1, 2].map(() => next() * 60)
    const members = Array.from({ length: 1 + Math.floor(next() * 5) }, () => {
      const near = next() < 0.5 ? 0 : next() * 200,
        far = next() < 0.25 ? 0 : near + 1 + next() * 300
      return { near, far, at: centre.map((c, a) => c + (next() * 2 - 1) * half[a]) }
    })
    const group = fitDrawDistances(members),
      scale = next() < 0.5 ? 1 : next() * 3
    const low = centre.map((c, a) => c - half[a]),
      high = centre.map((c, a) => c + half[a])
    if (!outsideGroupDrawDistance(group.near, group.far, low, high, scale)) {
      kept++
      continue
    }
    culled++
    for (const m of members)
      assert.ok(outsideDrawDistance(m.near, m.far, m.at, scale), 'a placement it would draw')
  }
  assert.ok(culled > 100 && kept > 100, `${culled} culled, ${kept} kept`)
})

test('the descent tests a placement’s draw distance by its mark before its frustum, a group’s before its box', () => {
  const before = (first: string, second: string) => {
    assert.ok(DAG_SELECTION_SHADER.includes(first), first)
    assert.ok(DAG_SELECTION_SHADER.indexOf(first) < DAG_SELECTION_SHADER.indexOf(second), first)
  }
  before('if(outsideDrawDistance(w,mark,node)){return;}', 'if(outsideFrustum(w,node.minimum')
  before('if(outsideGroupDrawDistance(t,lo,hi)){return;}', 'if(outsideView(lo,hi))')
  // A placement that names none reads no distance word: its mark's bit is tested first.
  assert.ok(DAG_SELECTION_SHADER.includes(`if((mark&${DRAW_DISTANCE_MARK}u)==0u||cullOff(`))
  assert.equal(DAG_SELECTION_SHADER.match(/cullOff\(CULL_DRAW_DISTANCE_OFF\)/g)?.length, 2)
})

/** The shipped draw distance WGSL, run in JavaScript for placement 3 and group 5, its pose a
 *  translation by `shift`: `view` is the uniform it reads, changed between calls. */
function drawKernel(shift = [0, 0, 0]) {
  const words = new Map<string, number>(),
    view = { viewDistanceScale: 1, occlusion: OCCLUSION_TWO_PASS, cullOff: 0 }
  const pose = new Mat([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, ...shift, 1])
  const kernel = shaderRun<{
    outsideDrawDistances(squared: number, near: number, far: number, scale: number): boolean
    outsideDrawDistance(
      w: number,
      mark: number,
      node: { minimum: number[]; maximum: number[] },
    ): boolean
    outsideGroupDrawDistance(t: number, low: number[], high: number[]): boolean
  }>(
    DAG_DRAW_DISTANCE_WGSL,
    ['outsideDrawDistances', 'outsideDrawDistance', 'outsideGroupDrawDistance'],
    {
      views: [view],
      OCCLUSION_TWO_PASS,
      CULL_DRAW_DISTANCE_OFF,
      cullOff: (bit: number) => (view.cullOff & bit) !== 0,
      preparedPose: () => pose,
      framesWord: (w: number, k: number) => words.get(`frame ${w} ${k}`) ?? 0,
      treeWord: (t: number, k: number) => words.get(`tree ${t} ${k}`) ?? 0,
    },
  )
  const set = (key: string, near: number, nearWord: number, far: number, farWord: number) => {
    words.set(`${key} ${nearWord}`, f32Bits(near))
    words.set(`${key} ${farWord}`, f32Bits(far))
  }
  return {
    view,
    ...kernel,
    placement: (near: number, far: number) =>
      set('frame 3', near, DRAW_NEAR_WORD, far, DRAW_FAR_WORD),
    group: (near: number, far: number) => set('tree 5', near, TREE_DRAW_NEAR, far, TREE_DRAW_FAR),
  }
}

test('the shipped kernel is out of the distances as the mirrored verdicts are, mark and switch gating it', () => {
  const next = lcgRandom(11),
    range = (low: number, high: number) => low + next() * (high - low)
  let culled = 0
  for (let n = 0; n < 3000; n++) {
    const shift = [range(-300, 300), range(-300, 300), range(-300, 300)],
      kernel = drawKernel(shift)
    kernel.view.viewDistanceScale = next() < 0.4 ? 1 : range(0, 3)
    const { viewDistanceScale: scale } = kernel.view
    const near = next() < 0.4 ? 0 : range(0, 200),
      far = next() < 0.25 ? 0 : near + range(1, 300)
    const low = [range(-40, 0), range(-40, 0), range(-40, 0)],
      high = low.map((v) => v + range(0, 80)),
      node = { minimum: low, maximum: high }
    kernel.placement(near, far)
    kernel.group(near, far)
    const centre = low.map((v, a) => 0.5 * (v + high[a]) + shift[a]),
      shifted = (box: number[]) => box.map((v, a) => v + shift[a])
    const expected = outsideDrawDistance(near, far, centre, scale)
    assert.equal(kernel.outsideDrawDistance(3, DRAW_DISTANCE_MARK, node), expected)
    assert.equal(
      kernel.outsideDrawDistances(
        centre[0] ** 2 + centre[1] ** 2 + centre[2] ** 2,
        near,
        far,
        scale,
      ),
      expected,
    )
    assert.equal(
      kernel.outsideGroupDrawDistance(5, shifted(low), shifted(high)),
      outsideGroupDrawDistance(near, far, shifted(low), shifted(high), scale),
    )
    if (expected) culled++
    // No bit in the mark, no distance; the host's switch off, neither a placement nor a group.
    assert.equal(kernel.outsideDrawDistance(3, 0, node), false)
    kernel.view.cullOff = CULL_DRAW_DISTANCE_OFF
    assert.equal(kernel.outsideDrawDistance(3, DRAW_DISTANCE_MARK, node), false)
    assert.equal(kernel.outsideGroupDrawDistance(5, shifted(low), shifted(high)), false)
  }
  assert.ok(culled > 300 && culled < 2700, `${culled} of 3000 culled`)
})

test('a group holding the eye is kept, a group naming no distance between its squares is kept, a one-pass cut tests no group', () => {
  const kernel = drawKernel(),
    around = [
      [-500, -500, -500],
      [500, 500, 500],
    ],
    beyond = [
      [190, -5, -5],
      [210, 5, 5],
    ]
  kernel.group(0, 100)
  assert.equal(kernel.outsideGroupDrawDistance(5, around[0], around[1]), false, 'the eye inside')
  assert.equal(kernel.outsideGroupDrawDistance(5, beyond[0], beyond[1]), true, 'past its farthest')
  assert.equal(outsideGroupDrawDistance(0, 100, around[0], around[1]), false)
  kernel.group(50, 50)
  assert.equal(kernel.outsideGroupDrawDistance(5, beyond[0], beyond[1]), false, 'min equal to max')
  assert.equal(outsideGroupDrawDistance(50, 50, beyond[0], beyond[1]), false)
  // A cut in one pass tests its placements alone: the group past its farthest is kept, a placement
  // of it is not.
  kernel.group(0, 100)
  kernel.placement(0, 100)
  kernel.view.occlusion = 0
  assert.equal(kernel.outsideGroupDrawDistance(5, beyond[0], beyond[1]), false)
  assert.equal(outsideGroupDrawDistance(0, 100, beyond[0], beyond[1], 1, false), false)
  const placed = drawKernel([200, 0, 0])
  placed.placement(0, 100)
  placed.view.occlusion = 0
  const box = { minimum: [-1, -1, -1], maximum: [1, 1, 1] }
  assert.equal(placed.outsideDrawDistance(3, DRAW_DISTANCE_MARK, box), true, 'a placement is')
})
