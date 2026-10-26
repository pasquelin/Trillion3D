// What a cut reads of a placement it makes where it reads it (`primitiveWgsl.ts`): a placement's
// record is its host words and its pose, 128 bytes at most whatever the placements, and no kernel
// derives anything into it — so a placement the descent never visits costs nothing. The GPU run
// against the uncached form is `tests/gpu/dag/prepare.gpu.ts`; here, the bytes, the sites that read
// the thread's pose, the one verdict that has a form of its own — a never-culled primitive's
// open planes — on every box, and the instance an assembly opens under its root. The draw distance
// a placement's mark gates has its own file (`drawDistance.test.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { WORKGROUP_THREADS } from '../../../gpu/dispatch/grid.ts'
import { DAG_SELECTION_SHADER } from './selectionShader.fixture.ts'
import { DAG_PRIMITIVE_WGSL } from './primitiveWgsl.ts'
import { FRAME_TABLE } from '../frameTable.ts'
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
import { DAG_ROOT_PARENT_WGSL } from './rootParentWgsl.ts'
import { outsideRootParent } from '../oracle/nodeVerdict.fixture.ts'

test('a placement holds 156 bytes at most, whatever the placements, past one row of the records', async () => {
  const [root] = packed(dagFixture()).roots
  // A row of the records holds 1024 placements of 112 bytes — world, exact translation, the proxy's
  // instance (`../worlds/worldTable.ts`) —, a row of the frame words 512 of 44 (`../frameTable.ts`): a
  // world of fewer pays those rows whole, once.
  const row = 1024 * 112 + 512 * 44
  for (const count of [1, 100, 5000]) {
    const dag = packDagSelection(Array.from({ length: count }, () => root))
    const resources = (await createDagResources(fakeDevice().device, dag))!
    const { rows, worlds } = resources.frames
    const bytes = rows.bytes + worlds.bytes
    assert.ok(
      bytes <= 156 * dag.worldCount + row,
      `${count} placements: ${bytes / dag.worldCount} B each`,
    )
  }
  const words = Object.values(FRAME_TABLE.fields).reduce((sum, texels) => sum + texels, 0)
  assert.equal(
    words,
    11,
    'its row, the two draw distances and the node of the parent it names, and its stretch, eleven words: no block derived beside them',
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

test('an instance of an assembly opens only while the error of the group above its root shows at its ball', () => {
  // The view at the origin looking down -z, a pixel scale of 1000 and a threshold of one pixel.
  const view = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  const frames = {
    views: [view],
    stretches: [1],
    focal: 1000,
    near: 0.1,
    perspective: 1,
    pixelError: 1,
  }
  const at = (z: number) => [0, 0, -z, 2]
  assert.equal(outsideRootParent(frames, 0, 1, at(100)), false, 'ten pixels: too coarse to draw')
  assert.equal(outsideRootParent(frames, 0, 1, at(900)), false, 'just over a pixel')
  assert.equal(
    outsideRootParent(frames, 0, 1, at(5000)),
    true,
    'a fifth of a pixel: its group draws',
  )
  // An exact group shows nowhere, and a placement scaled up shows it from farther.
  assert.equal(outsideRootParent(frames, 0, 0, at(1)), true)
  assert.equal(outsideRootParent(frames, 0, 1, at(3000)), true)
  assert.equal(outsideRootParent({ ...frames, stretches: [4] }, 0, 1, at(3000)), false)
  // The kernel runs the same comparison, on the ball and the error the node its frame word names
  // holds (`PARENT_SPHERE`, `PARENT_ERROR`), behind its mark's bit.
  const text = wgslSource(DAG_ROOT_PARENT_WGSL)
  assert.match(text, /fn outsideRootParent\(w:u32,mark:u32\)->bool/)
  assert.match(text, /\(mark&256u\)==0u/)
  assert.match(text, /framesWord\(w,9u\)/)
  assert.match(text, /bitcast<vec4f>\(nodesNode\(record,2u\)\)/)
  assert.match(
    text,
    /!errorShows\(sphereEdges\(sphere,viewWorld\(w\)\)\.x,bitcast<f32>\(nodesWord\(record,7u\)\)\)/,
  )
})
