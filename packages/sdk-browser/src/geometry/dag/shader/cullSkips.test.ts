// A test the DAG kernel does not make, on a verdict it already knows: the frustum skips an infinite
// far plane (`outsideFrustum`), which reaches the kernel as NaN and rejects no box. And the culls
// of a view beside the frustum: its clip plane and its filter (`clipPlaneWgsl.ts`,
// `viewFilterWgsl.ts`), the shipped WGSL run in JavaScript against the box's own corners.
import test from 'node:test'
import assert from 'node:assert/strict'
import { DAG_SELECTION_SHADER } from './shader.ts'
import { lcgRandom } from '../../../../../math/src/sequence/random.ts'
import { cameraSelectionUniforms } from '../../../gpu/core/selection.ts'
import { createEngineCamera, writeEngineCamera } from '../../../camera/engineCamera.ts'
import { frustumExcludesBox } from '../../../../../math/src/geometry/frustum/box.ts'
import { frustumPlanesToLocal } from '../oracle/math.fixture.ts'
import { DAG_CLIP_PLANE_WGSL } from './clipPlaneWgsl.ts'
import { CULL_CLIP_PLANE_OFF } from './viewsWgsl.ts'
import { OCCLUSION_TWO_PASS } from './occlusionWgsl.ts'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { Mat } from '../../../materials/texture/shaderRunMatrix.fixture.ts'

/** The planes a camera sends the kernel, `far` given, and whether `farless` reads them as farless. */
function cameraPlanes(far: number) {
  const cam = createEngineCamera()
  cam.world.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 3, 4, 5, 1])
  writeEngineCamera(cam, { fov: 60, aspect: 16 / 9, near: 0.1, far, zoom: 1 })
  const { planes } = cameraSelectionUniforms(cam, 1, [1280, 720])
  const bits = new Uint32Array(Float32Array.from(planes).buffer)
  return { planes: Float64Array.from(planes), farless: (bits[16] & 0x7fffffff) > 0x7f800000 }
}

test('an infinite far plane is read as absent, a declared one is tested', () => {
  assert.ok(DAG_SELECTION_SHADER.includes('if(i!=skip&&boxBehindPlane('))
  assert.equal(cameraPlanes(Infinity).farless, true)
  assert.equal(cameraPlanes(2000).farless, false)
})

test('skipping the infinite far plane keeps every box verdict, in any primitive space', () => {
  const { planes } = cameraPlanes(Infinity)
  const skipped = planes.slice()
  skipped.set([0, 0, 0, 1], 16)
  const next = lcgRandom(2222),
    local = new Float64Array(24),
    localSkipped = new Float64Array(24)
  const worlds = [
    [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    [0, 2, 0, 0, -2, 0, 0, 0, 0, 0, 2, 0, 5, -3, 7, 1],
  ]
  for (const world of worlds) {
    frustumPlanesToLocal(local, planes, world)
    frustumPlanesToLocal(localSkipped, skipped, world)
    assert.ok(Number.isNaN(local[16]), 'NaN through the primitive product')
    for (let n = 0; n < 5000; n++) {
      const c = [0, 1, 2].map(() => (next() - 0.5) * 2e4),
        h = [0, 1, 2].map(() => next() * 10 ** (next() * 4))
      const box = [c[0] - h[0], c[1] - h[1], c[2] - h[2], c[0] + h[0], c[1] + h[1], c[2] + h[2]]
      assert.equal(
        frustumExcludesBox(
          localSkipped,
          ...(box as [number, number, number, number, number, number]),
        ),
        frustumExcludesBox(local, ...(box as [number, number, number, number, number, number])),
      )
    }
  }
})

test('the descent tests a view’s filter first, its plane before its frustum, at every level that tests a frustum', () => {
  const before = (first: string, second: string) => {
    assert.ok(DAG_SELECTION_SHADER.includes(first), first)
    assert.ok(DAG_SELECTION_SHADER.includes(second), second)
    assert.ok(DAG_SELECTION_SHADER.indexOf(first) < DAG_SELECTION_SHADER.indexOf(second), first)
  }
  // A placement's root: the filter before anything is read of it, the plane after the distance.
  before('fn testRoot(dst:u32,w:u32){\n if(filteredOut(w)){return;}', 'let root=rootOf(w);')
  before('if(outsideDrawDistance(w,mark,node)){return;}', 'if(outsideClipPlane(w,node.minimum')
  before(
    'if(outsideClipPlane(w,node.minimum,node.maximum)){return;}',
    'if(outsideFrustum(w,node.minimum',
  )
  // A node, a cluster and a group of the tree.
  before(
    'if(outsideClipPlane(w,node.minimum,node.maximum)){return false;}',
    'if(outsideFrustum(w,node.minimum,node.maximum)){atomicAdd(&out.frustumRejected,1u);return false;}',
  )
  before('if(outsideClipPlane(w,boxMin(r),boxMax(r))){return;}', 'if(!visible(r,w,cluster))')
  before(
    'if(outsideGroupDrawDistance(t,lo,hi)){return;}',
    'if(outsideGroupClipPlane(t,lo,hi)){return;}',
  )
  before('if(outsideGroupClipPlane(t,lo,hi)){return;}', 'if(outsideView(lo,hi))')
  // The post pass tests neither again: what it holds passed them in the main pass.
  const post = DAG_SELECTION_SHADER.slice(DAG_SELECTION_SHADER.indexOf('fn dagPostPrepare'))
  const posted = post.slice(0, post.indexOf('fn dagPostClusters'))
  assert.doesNotMatch(posted, /filteredOut|outsideClipPlane|outsideGroupClipPlane/)
})

/** A box `[lo, hi]` in a placement's space, its pose `pose` (column-major, at the eye), the view's
 *  plane `plane` in the render frame: whether every corner of the box lies behind it. */
function cornersBehind(plane: number[], pose: number[], lo: number[], hi: number[]) {
  let best = -Infinity
  for (let corner = 0; corner < 8; corner++) {
    const p = [0, 1, 2].map((a) => ((corner >> a) & 1 ? hi[a] : lo[a]))
    const r = [0, 1, 2].map(
      (row) => pose[row] * p[0] + pose[4 + row] * p[1] + pose[8 + row] * p[2] + pose[12 + row],
    )
    best = Math.max(best, plane[0] * r[0] + plane[1] * r[1] + plane[2] * r[2] + plane[3])
  }
  return best
}

/** The shipped clip plane WGSL for placement 3, group 5 and the view `view`, its pose `pose`. */
function clipKernel(
  pose: number[],
  view: { clipPlane: number[]; occlusion: number; cullOff: number },
  placement = { unculled: false, reach: 0 },
) {
  const matrix = new Mat(pose),
    transposed = new Mat([0, 1, 2, 3].flatMap((c) => [0, 1, 2, 3].map((r) => pose[r * 4 + c])))
  return shaderRun<{
    outsideClipPlane(w: number, lo: number[], hi: number[]): boolean
    outsideGroupClipPlane(t: number, lo: number[], hi: number[]): boolean
  }>(DAG_CLIP_PLANE_WGSL, ['outsideClipPlane', 'outsideGroupClipPlane'], {
    views: [view],
    OCCLUSION_TWO_PASS,
    CULL_CLIP_PLANE_OFF,
    TREE_GROUP: 1,
    cullOff: (bit: number) => (view.cullOff & bit) !== 0,
    placed: () => {},
    placedT: transposed,
    placedPose: matrix,
    reachOf: () => placement.reach,
    unculledOf: () => placement.unculled,
    grownPlane: (p: number[], reach: number) => [
      p[0],
      p[1],
      p[2],
      p[3] + reach * (Math.abs(p[0]) + Math.abs(p[1]) + Math.abs(p[2])),
    ],
    treeWord: (_t: number, _k: number) => 1,
  })
}

test('a box is out of the plane where every corner lies behind it, whatever its placement’s pose and scale', () => {
  const next = lcgRandom(77)
  const range = (low: number, high: number) => low + next() * (high - low)
  let culled = 0,
    kept = 0
  for (let n = 0; n < 4000; n++) {
    // A rotation about a random axis, scaled per axis from a quarter to three times, then moved.
    const axis = [range(-1, 1), range(-1, 1), range(-1, 1)],
      len = Math.hypot(...axis) || 1,
      [x, y, z] = axis.map((a) => a / len),
      angle = range(0, 6.28),
      c = Math.cos(angle),
      s = Math.sin(angle),
      k = 1 - c
    const rot = [
      c + x * x * k,
      y * x * k + z * s,
      z * x * k - y * s,
      x * y * k - z * s,
      c + y * y * k,
      z * y * k + x * s,
      x * z * k + y * s,
      y * z * k - x * s,
      c + z * z * k,
    ]
    const scale = [0.25, 1, 3].map((v) => (next() < 0.5 ? v : range(0.25, 3)))
    const pose = [
      ...rot.slice(0, 3).map((v) => v * scale[0]),
      0,
      ...rot.slice(3, 6).map((v) => v * scale[1]),
      0,
      ...rot.slice(6, 9).map((v) => v * scale[2]),
      0,
      range(-50, 50),
      range(-50, 50),
      range(-50, 50),
      1,
    ]
    const nrm = [range(-1, 1), range(-1, 1), range(-1, 1)],
      nl = Math.hypot(...nrm) || 1,
      plane = [...nrm.map((a) => a / nl), range(-30, 30)]
    const lo = [range(-10, 0), range(-10, 0), range(-10, 0)],
      hi = lo.map((v) => v + range(0, 20))
    const kernel = clipKernel(pose, { clipPlane: plane, occlusion: 0, cullOff: 0 })
    const reach = cornersBehind(plane, pose, lo, hi)
    // A corner within a hair of the plane could go either way in single precision: not judged.
    if (Math.abs(reach) < 1e-3) continue
    assert.equal(kernel.outsideClipPlane(3, lo, hi), reach < 0, `case ${n}`)
    if (reach < 0) culled++
    else kept++
  }
  assert.ok(culled > 400 && kept > 400, `${culled} culled, ${kept} kept`)
})

/** The verdict with the extent scaled twice — the box's half along each axis times the placement's
 *  scale of it, times the local plane's normal, which carries that scale already —: the test this
 *  one replaces, whose only difference is that factor. */
function extentScaledTwice(plane: number[], scale: number, centre: number[], half: number[]) {
  const local = [plane[0] * scale, plane[1] * scale, plane[2] * scale],
    distance = local.reduce((sum, v, a) => sum + v * centre[a], plane[3])
  return distance < -local.reduce((sum, v, a) => sum + Math.abs(half[a] * scale * v), 0)
}

test('a placement scaled under 1 loses nothing at the plane: its scale enters the verdict once', () => {
  // A box of half 1 about the origin, the placement scaled by 0.25: it reaches x = 0.25, past the
  // plane x = 0.1, which cuts it.
  const pose = [0.25, 0, 0, 0, 0, 0.25, 0, 0, 0, 0, 0.25, 0, 0, 0, 0, 1],
    plane = [1, 0, 0, -0.1]
  const kernel = clipKernel(pose, { clipPlane: plane, occlusion: 0, cullOff: 0 })
  assert.ok(cornersBehind(plane, pose, [-1, -1, -1], [1, 1, 1]) > 0, 'a corner lies in front')
  assert.equal(kernel.outsideClipPlane(3, [-1, -1, -1], [1, 1, 1]), false, 'it straddles: kept')
  // The extent scaled twice reaches 0.0625 where the box reaches 0.25, and culls it whole.
  assert.equal(extentScaledTwice(plane, 0.25, [0, 0, 0], [1, 1, 1]), true)
  // At scale 1 the two are the one verdict, on any box.
  const next = lcgRandom(5)
  for (let n = 0; n < 500; n++) {
    const unit = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      p = [next() - 0.5, next() - 0.5, next() - 0.5].map((v) => v * 2),
      d = [...p, (next() - 0.5) * 20],
      lo = [-1, -1, -1].map((v) => v * next() * 5),
      hi = [1, 1, 1].map((v) => v * next() * 5)
    const centre = lo.map((v, a) => (v + hi[a]) / 2),
      half = lo.map((v, a) => (hi[a] - v) / 2)
    assert.equal(
      clipKernel(unit, { clipPlane: d, occlusion: 0, cullOff: 0 }).outsideClipPlane(3, lo, hi),
      extentScaledTwice(d, 1, centre, half),
    )
  }
})

test('the switch, a plane of none, a cut in one pass for a group, and a cell above the groups skip the plane', () => {
  const pose = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    view = { clipPlane: [0, 0, 1, -100], occlusion: OCCLUSION_TWO_PASS, cullOff: 0 }
  const box = [
    [-1, -1, -1],
    [1, 1, 1],
  ]
  const kernel = clipKernel(pose, view)
  assert.equal(kernel.outsideClipPlane(3, box[0], box[1]), true, 'wholly behind z = 100')
  assert.equal(kernel.outsideGroupClipPlane(5, box[0], box[1]), true, 'a group of the tree')
  view.occlusion = 0
  assert.equal(
    kernel.outsideGroupClipPlane(5, box[0], box[1]),
    false,
    'a cut in one pass tests no group',
  )
  assert.equal(kernel.outsideClipPlane(3, box[0], box[1]), true, 'but its placements')
  view.occlusion = OCCLUSION_TWO_PASS
  view.cullOff = CULL_CLIP_PLANE_OFF
  assert.equal(kernel.outsideClipPlane(3, box[0], box[1]), false, 'the host turned the cull off')
  assert.equal(kernel.outsideGroupClipPlane(5, box[0], box[1]), false)
  view.cullOff = 0
  view.clipPlane = [0, 0, 0, 0]
  assert.equal(kernel.outsideClipPlane(3, box[0], box[1]), false, 'no plane')
  assert.equal(kernel.outsideGroupClipPlane(5, box[0], box[1]), false)
  // A cell above the groups: its kind word is not a group's.
  view.clipPlane = [0, 0, 1, -100]
  const cell = shaderRun<{ outsideGroupClipPlane(t: number, lo: number[], hi: number[]): boolean }>(
    DAG_CLIP_PLANE_WGSL,
    ['outsideGroupClipPlane'],
    {
      views: [view],
      OCCLUSION_TWO_PASS,
      CULL_CLIP_PLANE_OFF,
      TREE_GROUP: 1,
      cullOff: () => false,
      treeWord: () => 0,
      placed: () => {},
      placedT: new Mat(pose),
      reachOf: () => 0,
      unculledOf: () => false,
      grownPlane: () => [0, 0, 0, 1],
    },
  )
  assert.equal(cell.outsideGroupClipPlane(5, box[0], box[1]), false, 'a cell of the tree')
})

test('a placement no camera culls is never culled, one that deforms is judged by its box grown', () => {
  const pose = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    view = { clipPlane: [0, 0, 1, -100], occlusion: OCCLUSION_TWO_PASS, cullOff: 0 }
  const box = [
    [-1, -1, 98.5],
    [1, 1, 99.5],
  ]
  assert.equal(clipKernel(pose, view).outsideClipPlane(3, box[0], box[1]), true)
  const sprite = clipKernel(pose, view, { unculled: true, reach: 0 })
  assert.equal(sprite.outsideClipPlane(3, box[0], box[1]), false, 'never culled')
  const deformed = clipKernel(pose, view, { unculled: false, reach: 1 })
  assert.equal(deformed.outsideClipPlane(3, box[0], box[1]), false, 'its reach crosses z = 100')
})
