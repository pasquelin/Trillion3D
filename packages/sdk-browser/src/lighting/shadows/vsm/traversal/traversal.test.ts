// The shadow views' descent (`traversalWgsl.ts`). Split from `../rasterSkips.test.ts` and
// `../render/renderParams.test.ts` by subject, as the bound on a test file's lines asks.

import { mulberry32 } from '../../../../../../math/src/sequence/random.ts'
import test from 'node:test'
import { fakeDevice } from '../../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { createVsmResources } from '../resources.ts'
import { encodeVsmRender } from '../render/renderPass.ts'
import { compiled, encodeRows, recordingRaster } from '../recordingRaster.fixture.ts'
import { DAG_ARGS } from '../../../../geometry/dag/shader/armWgsl.ts'
import {
  countWord,
  priorityWord,
  SELECTION_HEADER_WORDS,
} from '../../../../geometry/dag/readoutWords.ts'
import { noteVsmRequestSet, vsmDescentRequestsSubmitted, vsmShadowRequestCuts } from './requests.ts'
const LIMITS = { maxStorageBufferBindingSize: 1 << 27, maxBufferSize: 1 << 27 }
import assert from 'node:assert/strict'
import { wgslConstants } from '../../../../materials/texture/shaderRule.fixture.ts'

import { vsmRenderCullWgsl } from '../render/renderCullWgsl.ts'

import { shaderRun } from '../../../../materials/texture/shaderRun.fixture.ts'

import { FRAME_COUNTERS } from '../../../../geometry/dag/shader/floorWgsl.ts'

import { vsmDescentWgsl } from '../traversal/traversalWgsl.ts'
import { VSM_LIGHT_WORDS } from '../constants.ts'

import { Mat } from '../../../../materials/texture/shaderRunMatrix.fixture.ts'
import { SUNS_LAYOUT } from '../layout.fixture.ts'

const LAYOUT = SUNS_LAYOUT
const CULL = vsmRenderCullWgsl(LAYOUT)

// The smallest projected edge scale of a ball of view-space centre `c` and radius `r`, as the
// reference's `GetProjectedEdgeScales` derives its `.x` (the eye at zero looking down -z).
const smallestEdgeScale = (c: number[], r: number, near: number) => {
  const distSq = c[0]! ** 2 + c[1]! ** 2 + c[2]! ** 2
  const z = -c[2]!
  const axisSq = distSq - z * z
  const axis = Math.sqrt(Math.max(0, axisSq))
  const tangentSq = distSq - r * r
  const tangent = Math.sqrt(Math.max(0, tangentSq))
  let top = (-r * axis + tangent * z) / distSq
  if (tangentSq < 0 || top * tangent < near) {
    const across = axis + Math.sqrt(r * r - (near - z) ** 2)
    top = near / Math.sqrt(across * across + near * near)
  }
  return z + r > near ? Math.max(z - r, near) * top : 0
}

// The shadow views' descent drops a node only where no cluster under it could be drawn in that map's
// mip (`traversal/traversalWgsl.ts`, `vsmDescentNeeded`): the error its clusters replace shows at the
// edge scale of the node's ball, and a cluster's parent error shows at the edge scale of its own
// ball, within the node's — the cull draws a cluster only where that error shows
// (`vsmRenderLodAt`). Random balls and errors under a node, perspective and orthographic maps, at the
// finest mip and a coarser one; the scale is the reference's smallest edge scale of the ball, and
// whatever shows at a cluster shows at the node, both multiplied out.
test('a shadow view’s descent keeps every node a cluster under it could be drawn from', () => {
  const C = wgslConstants(CULL)
  const perspective = new Mat([1.2, 0, 0, 0, 0, 1.2, 0, 0, 0, 0, 0, -1, 0, 0, 0.1, 0])
  const ortho = new Mat([0.01, 0, 0, 0, 0, 0.01, 0, 0, 0, 0, 0.001, 0, 0, 0, 0.5, 1])
  const random = mulberry32(11)
  const threshold = 1.5
  const cull = shaderRun<{
    vsmRenderEdgeScale(...a: unknown[]): number
    vsmRenderErrorShows(...a: unknown[]): boolean
  }>(CULL, ['vsmRenderEdgeScale', 'vsmRenderErrorShows'], { ...C, params: { threshold } })
  let shown = 0
  for (const viewToClip of [perspective, ortho]) {
    const isOrtho = viewToClip[3][3] >= 1
    const near = isOrtho ? 0 : viewToClip[3][2] / (1 - viewToClip[2][2])
    for (let k = 0; k < 400; k++) {
      const centre = [random() * 40 - 20, random() * 40 - 20, -30 - random() * 200]
      const radius = 0.5 + random() * 10,
        error = random() * 0.5
      // A ball within the node's, an error no greater.
      const inner = radius * random()
      const dir = [random() - 0.5, random() - 0.5, random() - 0.5]
      const len = Math.hypot(...dir) || 1
      const offset = (radius - inner) * random()
      const ball = centre.map((c, a) => c + (dir[a]! / len) * offset)
      for (const mip of [0, 3]) {
        const focal = 0.5 * Math.abs(viewToClip[1][1]) * (C.VSM_LEVEL0_TEXELS! >> mip)
        const lens = { focal, near, perspective: !isOrtho }
        const scale = cull.vsmRenderEdgeScale(centre, radius, viewToClip, viewToClip, lens)
        const ballScale = cull.vsmRenderEdgeScale(ball, inner, viewToClip, viewToClip, lens)
        const clusterError = error * random()
        const at = (e: number, c: number[], r: number) =>
          isOrtho ? 1 : smallestEdgeScale([c[0]!, c[1]!, c[2]!], r, near)
        assert.ok(Math.abs(scale - at(error, centre, radius)) <= 1e-4 * Math.max(scale, 1e-9))
        assert.ok(Math.abs(ballScale - at(error, ball, inner)) <= 1e-4 * Math.max(ballScale, 1e-9))
        const cluster = cull.vsmRenderErrorShows(ballScale, clusterError, focal)
        const node = cull.vsmRenderErrorShows(scale, error, focal)
        if (cluster) {
          shown++
          assert.ok(node, `${k} mip ${mip}: shows at the cluster, not at the node`)
        }
      }
    }
  }
  assert.ok(shown > 50, `${shown} clusters showed an error`)
})

// The shadow views descend the cut's hierarchy with the camera's kernels (`../traversal/`), at the
// head of the raster's first compute pass: the views, queue 0, level 0 flat, each later level on
// the arguments armed in the pass, the close; the casters' kernel then runs on the argument the
// descent armed for the pages it listed (`DAG_ARGS.cand`), not over every packed page.
test('the shadow views descend the hierarchy first, and the casters run over the pages it listed', async () => {
  const fake = fakeDevice({ limits: LIMITS })
  await compiled(fake, () => encodeRows(fake.device, fake.device.createCommandEncoder(), {}))
  const order = fake.dispatches.map(({ entryPoint }) => entryPoint)
  assert.deepEqual(order.slice(0, 9), [
    'vsmDescentViews',
    'vsmDescentPrepare',
    'dagLevel0',
    'dagArm',
    'dagLevel1',
    'dagArm',
    'vsmDescentClose',
    'vsmRenderCandidates',
    'vsmRenderCandidatesDone',
  ])
  const args = fake.buffers.find((b) => b.label === 'vsm.descent.args')!
  const casters = fake.dispatches.find((d) => d.entryPoint === 'vsmRenderCandidates')!
  assert.equal(casters.buffer, args as unknown as GPUBuffer)
  assert.equal(casters.offset, DAG_ARGS.cand)
})

/** A recording device, the resources of a set of suns at 256 pages, the recording raster, and the
 *  lights of one sun's seventeen maps. */
function sunSet() {
  const fake = fakeDevice({ limits: LIMITS })
  const res = createVsmResources(fake.device, {
    coverMode: 'suns',
    fullMapCapacity: 63,
    poolPages: 256,
  })
  const raster = recordingRaster(fake.device, 1000)
  const lights = [{ kind: 'directional' as const, firstId: 0, count: 17 }]
  return { fake, res, raster, lights }
}

// A leaf a shadow view keeps is asked for in the descent's readout, laid as the camera cut's; the
// copy lands a few frames later, and the streaming reads it beside the views' readbacks, one list
// made again only when it changes (`../traversal/requests.ts`).
test('the leaves the shadow views ask for reach the streaming beside the views’ readbacks', async () => {
  const { fake, res, raster, lights } = sunSet()
  encodeVsmRender(raster.encoder, res, { device: fake.device, lights }, raster.scene)
  // The descent asked for one leaf: 3 pages from page 42, at priority word 7.
  const out = fake.buffers.find((b) => b.label === 'vsm.descent.out')!
  const words = new Uint32Array((out as unknown as { data: Uint8Array }).data.buffer)
  const ranks = raster.scene.descent.info.listCap
  words[0] = 1
  words[SELECTION_HEADER_WORDS] = 42
  words[priorityWord(ranks)] = 7
  words[countWord(ranks)] = 3
  fake.device.queue.submit([])
  const session = {}
  noteVsmRequestSet(session, res)
  const handed = { cuts: [], first: null }
  assert.equal(vsmShadowRequestCuts(session, handed), handed, 'nothing landed yet')
  // The copy is recorded after the words were set: encode the next frame's to take them.
  encodeVsmRender(raster.encoder, res, { device: fake.device, lights }, raster.scene)
  vsmDescentRequestsSubmitted(res)
  await new Promise((done) => setTimeout(done, 0))
  const merged = vsmShadowRequestCuts(session, handed)
  assert.equal(merged.cuts.length, 1)
  assert.deepEqual(merged.cuts[0]!.result.requests, { pages: [42], counts: [3], priorities: [7] })
  // A cut the streaming may read whole: its uniforms are a block, not a hole.
  assert.ok(merged.cuts[0]!.uniforms.planes instanceof Float32Array)
  assert.equal(vsmShadowRequestCuts(session, handed), merged, 'the same list while nothing changes')
})

// The descent's groups are made again only when what they bind moves (`createWebgpuBindIdentity`,
// `vsmPerFrameSet`): frames of a still scene make its culling and arming groups once, its VSM group
// once a frame set — the two sets in turn.
test('the descent’s groups are made once, its VSM group once a frame set', () => {
  const { fake, res, raster, lights } = sunSet()
  for (let f = 0; f < 4; f++) {
    encodeVsmRender(raster.encoder, res, { device: fake.device, lights }, raster.scene)
    res.swapFrames()
  }
  const made = (label: string) => fake.bindGroups.filter((g) => g.label === label).length
  assert.deepEqual(
    ['vsm.descent.culling', 'vsm.descent.arm', 'vsm.descent.vsm'].map(made),
    [1, 1, 2],
  )
})

// A view of the shadow views' descent is a map of a light and a mip of it that has a page to draw
// (`vsmDescentViews`): a light lists one for each such mip of each of its maps, in the room the
// parameters name, and the post pass of a view pass judges the held nodes of the maps of that pass
// alone (`heldHere`). The lights are read from the descent's `work`, where the frame copies them.
test('the descent lists a view for each mip of each map of a light that has a page to draw', () => {
  const descent = vsmDescentWgsl(LAYOUT)
  // Light 0 holds maps 0 and 1 — map 0 has pages to draw in mips 0 and 2, map 1 in none —, light 1
  // the map 5, mip 0. The counters, the views' count and its four places, then the lights.
  const light = (first: number, count: number, channels: number) => [
    ...[first, count, channels],
    ...new Array(VSM_LIGHT_WORDS - 3).fill(0),
  ]
  const work = [
    ...new Array(FRAME_COUNTERS + 1 + 4).fill(0),
    ...light(0, 2, 0b011),
    ...light(5, 1, 0b100),
  ]
  const mips = new Map([
    [0, 0b101],
    [1, 0],
    [5, 0b1],
  ])
  const scope = {
    ...wgslConstants(descent),
    work,
    params: { lightCount: 2, viewCap: 4, viewFirst: 0, viewCount: 4 },
    vsm: { mapCount: 100 },
    vsmRenderMapMips: (map: number) => mips.get(map),
  }
  const run = shaderRun<{
    vsmDescentViews(id: number[], groups: number[]): void
    heldHere(view: number): boolean
  }>(descent, ['vsmDescentViews', 'heldHere'], scope)
  for (const rank of [0, 1]) run.vsmDescentViews([rank, 0, 0], [1, 1, 1])
  assert.equal(work[FRAME_COUNTERS], 3, 'a view for each mip with pages')
  // The map, the mip above its sixteen bits and the light's channels above the mip's three.
  assert.deepEqual(work.slice(FRAME_COUNTERS + 1, FRAME_COUNTERS + 4), [
    0b011 << 19,
    (2 << 16) | (0b011 << 19),
    5 | (0b100 << 19),
  ])
  // The views of the maps 0 to 3: the pass's own; the map 5 belongs to another.
  assert.deepEqual([0, 1, 2].map(run.heldHere), [true, true, false])
})

// The sight of a node in a shadow view (`boxSight`): none while the previous frame's pyramid is not
// kept; else, in the main pass, held for the post pass when the previous pyramid hides it in both
// layers of the map, seen when either shows it; in the post pass, gone when this frame's pyramid
// hides it in both layers, seen otherwise. The box is projected under the previous view once and
// tested in both layers; a placement whose linear part stood still has its current half axes for it.
test('a node hidden by a view’s pyramid in both layers is held, then gone; shown in one, it is seen', () => {
  const descent = vsmDescentWgsl(LAYOUT)
  const C = wgslConstants(descent)
  const hidden = { static: true, dynamic: true }
  let pass = C.CUT_MAIN
  let still = true
  const asked = { projections: 0, prevAxes: 0 }
  const layer = (staticLayer: boolean) => (staticLayer ? hidden.static : hidden.dynamic)
  const box = {
    ...{
      center: [0, 0, 0],
      axes: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      cull: {},
    },
    ...{ high: [0, 0, 0, 1], low: [0, 0, 0] },
  }
  const run = shaderRun<{ boxSight(lo: number[], hi: number[], w: number): number }>(
    descent,
    ['boxSight'],
    {
      ...C,
      cutView: { occlusion: C.OCCLUSION_TWO_PASS, cameraWorld: [0, 0, 0] },
      cutPass: () => pass,
      rootWords: [],
      vsmRenderPrevShift: () => [0, 0, 0],
      vsmRenderPrevStill: () => still,
      vsmRenderPrevAxes: () => asked.prevAxes++,
      descentMap: () => 3,
      descentMip: () => 2,
      vsmHandleFromId: (id: number) => ({ id }),
      vsmProjectionOf: () => ({ lightKind: 1 }),
      // The node's view of the running entry, built once (`vsmDescentBegin`): its map's record, its box
      // carrying its sphere and the growth its map allows.
      descentHeld: { pd: { lightKind: 1 }, box, growth: 0 },
      vsmDescentBox: () => ({ center: [0, 0, 0], axes: [], cull: {} }),
      vsmPrevViewHolds: () => true,
      vsmPrevBoxInView: () => (asked.projections++, {}),
      vsmHiddenBefore: (...a: unknown[]) => layer(a[4] as boolean),
      vsmDescentHiddenNow: (...a: unknown[]) => layer(a[4] as boolean),
    },
  )
  const sight = (w = 7) => run.boxSight([0, 0, 0], [1, 1, 1], w)
  for (const w of [7, C.NO_INDEX]) {
    pass = C.CUT_MAIN
    assert.equal(sight(w), C.BOX_OCCLUDED, `${w}: hidden in both layers, held`)
    hidden.dynamic = false
    assert.equal(sight(w), C.BOX_SEEN, `${w}: shown in one layer, seen`)
    pass = C.CUT_POST
    assert.equal(sight(w), C.BOX_SEEN, `${w}: post, shown in one layer, seen`)
    hidden.dynamic = true
    assert.equal(sight(w), C.BOX_CULLED, `${w}: post, hidden in both layers, gone`)
  }
  // The box under the previous view is projected once for the two layers; the previous half axes
  // are made only for a placement whose linear part changed.
  pass = C.CUT_MAIN
  asked.projections = asked.prevAxes = 0
  sight(7)
  assert.deepEqual([asked.projections, asked.prevAxes], [1, 0], 'still: one projection, no axes')
  still = false
  asked.projections = asked.prevAxes = 0
  sight(7)
  assert.deepEqual([asked.projections, asked.prevAxes], [1, 1], 'turned: its previous axes made')
})

// With the previous frame's pyramid and tables kept, a view pass judges the nodes its first descent
// held back once its pyramid is built — the held nodes, then every level again on those seen —, lists
// the casters of the pages they hold behind the main pass's, and culls them and the records held
// back, against this frame's pyramid.
test('with the previous frame kept, the post pass of the descent follows the pyramid’s build', async () => {
  const { fake, res, raster, lights } = sunSet()
  res.occlusion!.prevKept = true
  await compiled(fake, () =>
    encodeVsmRender(
      fake.device.createCommandEncoder(),
      res,
      { device: fake.device, lights },
      raster.scene,
    ),
  )
  const order = fake.dispatches.map(({ entryPoint }) => entryPoint)
  const post = order.slice(order.indexOf('vsmBuildPyramidTop') + 1)
  assert.deepEqual(post, [
    ...['dagPostPrepare', 'dagArm', 'dagPostNodes', 'dagArm', 'dagLevel0', 'dagArm', 'dagLevel1'],
    ...['dagArm', 'vsmDescentClose', 'vsmRenderCandidates', 'vsmRenderCandidatesPostDone'],
    ...['vsmRenderArgsSecond', 'vsmRenderCullPost', 'vsmRenderCullSecond'],
    ...['vsmRenderArgsBin', 'vsmRenderBin'],
  ])
  assert.ok(
    order.includes('vsmRenderCullFirst'),
    'the first cull tests against the previous pyramid',
  )
})

// The descent culls a node by its own oriented box under its placement (`casterSphere`'s half axes,
// `vsmCasterBoxInView`), as the casters' cull does a cluster; the light's range, the pages to draw and
// the previous image's occlusion test read the same box.
const PROJECTION = new Mat([1.2, 0, 0, 0, 0, 1.2, 0, 0, 0, 0, 0, -1, 0, 0, 0.1, 0])
const boxPd = (lightKind: number) => ({
  ...{ shiftedToMapUv: PROJECTION, lightViewToClip: PROJECTION, lightKind },
  ...{ originShiftHigh: [0, 0, 0], originShiftLow: [0, 0, 0] },
})

test('the descent’s box is the node’s oriented box as it is, and the range is tested on it', () => {
  const code = vsmDescentWgsl(LAYOUT)
  const C = wgslConstants(code)
  const asked: unknown[][] = []
  const { vsmDescentBox } = shaderRun<{ vsmDescentBox(...a: unknown[]): Record<string, number[]> }>(
    code,
    ['vsmDescentBox'],
    {
      ...C,
      vsmShiftedToClip: (m: Mat) => m,
      vsmCasterBoxInView: (...a: unknown[]) => (asked.push(a), { inMapView: true }),
    },
  )
  // A sphere of radius 2 about (3, 4, 0), the box's half axes along the world's: 1, 2 and 3.
  const axes = [
    [1, 0, 0],
    [0, 2, 0],
    [0, 0, 3],
  ]
  const box = vsmDescentBox(boxPd(C.LIGHT_KIND_DIRECTIONAL! + 1), [3, 4, 0, 2], [0, 0, 0], axes)
  const near = (a: number[], b: number[]) =>
    a.every((x, k) => Math.abs(x - b[k]!) <= 1e-5 * Math.max(1, Math.abs(b[k]!)))
  assert.ok(near(Array.from(box.center!), [3, 4, 0]))
  // The cull is the casters' on the box, its axes unchanged.
  const args = asked[0]! as number[][]
  assert.ok(near(Array.from(args[0]!), [3, 4, 0]))
  for (let a = 0; a < 3; a++) assert.ok(near(Array.from(args[1 + a]!), axes[a]!))
  assert.equal(asked[0]![7], true, 'a local light clips at the near plane')
  // A local light's range is tested on the box: a box of half axes 1, 2, 3 about (3, 4, 0) lies
  // 0 from a light of range 10 at the origin, wholly past a light of range 0.5 at 10 away.
  const { vsmDescentBoxInMap } = shaderRun<{ vsmDescentBoxInMap(...a: unknown[]): boolean }>(
    code,
    ['vsmDescentBoxInMap'],
    {
      ...C,
      vsmCasterPastRange: (
        centre: number[],
        a0: number[],
        a1: number[],
        a2: number[],
        r: number,
      ) => {
        const gap = centre.map((c, k) =>
          Math.max(Math.abs(c) - (Math.abs(a0[k]!) + Math.abs(a1[k]!) + Math.abs(a2[k]!)), 0),
        )
        return gap.reduce((sum, g) => sum + g * g, 0) > r * r
      },
    },
  )
  const held = { ...box, cull: { inMapView: true } }
  const local = { ...boxPd(C.LIGHT_KIND_DIRECTIONAL! + 1), lightRange: 10 }
  assert.equal(vsmDescentBoxInMap(local, { ...held, axes }), true)
  assert.equal(
    vsmDescentBoxInMap({ ...local, lightRange: 0 }, { ...held, axes, center: [30, 0, 0] }),
    false,
  )
  assert.equal(
    vsmDescentBoxInMap(
      { ...boxPd(C.LIGHT_KIND_DIRECTIONAL!), lightRange: 0 },
      { ...held, axes, center: [30, 0, 0] },
    ),
    true,
    'a sun has no range',
  )
})

test('a node is outside the view where its map does not hold its box or nothing under it is drawn', () => {
  const code = vsmDescentWgsl(LAYOUT)
  const C = wgslConstants(code)
  // `outsideFrustum` asks the node's box of the map and of the clusters' drawing (`vsmDescentNotDrawn`):
  // out of the map's box, or nothing under it drawn; a placement the light's channels shut is out at once.
  const box = { box: true }
  const asked: unknown[][] = []
  let inMap = true,
    notDrawn = false
  const held = { shut: false, pd: { pd: true, handle: { id: 3 } }, box }
  const { outsideFrustum } = shaderRun<{ outsideFrustum(...a: unknown[]): boolean }>(
    code,
    ['outsideFrustum'],
    {
      ...C,
      descentHeld: held,
      vsmDescentBoxInMap: () => inMap,
      vsmDescentNotDrawn: (...a: unknown[]) => (asked.push(a), notDrawn),
    },
  )
  assert.equal(outsideFrustum(7, [0, 0, 0], [1, 1, 1]), false)
  assert.deepEqual(asked.at(-1), [7, { id: 3 }, held.pd, box], 'the node’s box')
  notDrawn = true
  assert.equal(outsideFrustum(7, [0, 0, 0], [1, 1, 1]), true, 'nothing under it drawn')
  asked.length = 0
  inMap = false
  assert.equal(outsideFrustum(7, [0, 0, 0], [1, 1, 1]), true, 'outside the map’s box')
  assert.deepEqual(asked, [], 'the drawing is not asked')
  inMap = true
  held.shut = true
  assert.equal(
    outsideFrustum(7, [0, 0, 0], [1, 1, 1]),
    true,
    'a placement in none of the light’s channels',
  )
  assert.deepEqual(asked, [], 'the box is not even asked')
})
