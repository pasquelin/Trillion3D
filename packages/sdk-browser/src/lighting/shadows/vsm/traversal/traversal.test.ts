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

import { vsmLayout } from '../layout.ts'
import { FRAME_COUNTERS } from '../../../../geometry/dag/shader/floorWgsl.ts'

import { vsmDescentWgsl } from '../traversal/traversalWgsl.ts'

import { Mat } from '../../../../materials/texture/shaderRunMatrix.fixture.ts'

const LAYOUT = vsmLayout({ fullMapCapacity: 7, sunMapCapacity: 3 })
/** A pointer, as a shader run hands one: what `&x` gives. */
type Ref = { set(value: unknown): void }
const CULL = vsmRenderCullWgsl(LAYOUT)

// The shadow views' descent drops a node only where no cluster under it could be drawn in that map's
// mip (`traversal/traversalWgsl.ts`, `vsmDescentNeeded`): the greatest error its clusters replace
// over the node's ball, projected by the view's mip, bounds every cluster's parent error over its
// own ball within it — the cull draws a cluster only where that error shows
// (`vsmRenderLodAt`). Random balls and errors under a node, perspective and orthographic maps,
// at the finest mip and a coarser one.
test('a shadow view’s descent keeps every node a cluster under it could be drawn from', () => {
  const descent = vsmDescentWgsl(LAYOUT)
  const C = wgslConstants(descent)
  const perspective = new Mat([1.2, 0, 0, 0, 0, 1.2, 0, 0, 0, 0, 0, -1, 0, 0, 0.1, 0])
  const ortho = new Mat([0.01, 0, 0, 0, 0, 0.01, 0, 0, 0, 0, 0.001, 0, 0, 0, 0.5, 1])
  const random = mulberry32(11)
  for (const viewToClip of [perspective, ortho]) {
    const pd = {
      ...{ lightViewToClip: viewToClip, shiftedToMapUv: viewToClip, finestMip: 0 },
      ...{ originShiftHigh: [0, 0, 0], originShiftLow: [0, 0, 0] },
    }
    const run = shaderRun<{ vsmDescentPixels(...a: unknown[]): number }>(
      descent,
      ['vsmDescentPixels'],
      {
        ...C,
        vsmProjectionOf: () => pd,
        vsmHandleFromId: (id: number) => ({ id }),
        vsmShiftedToClip: (m: Mat) => m,
      },
    )
    const cull = shaderRun<{ vsmRenderViewPixels(...a: unknown[]): number }>(
      CULL,
      ['vsmRenderViewPixels'],
      wgslConstants(CULL),
    )
    const ortho = viewToClip[3][3] >= 1
    const near = ortho ? 0 : viewToClip[3][2] / (1 - viewToClip[2][2])
    for (let k = 0; k < 200; k++) {
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
        const node = run.vsmDescentPixels(0, mip, centre, radius, error)
        const focal = 0.5 * Math.abs(viewToClip[1][1]) * (C.VSM_LEVEL0_TEXELS >> mip)
        const persp = ortho ? 0 : 1
        const cluster = cull.vsmRenderViewPixels(
          error * random(),
          ball,
          inner,
          viewToClip,
          viewToClip,
          focal,
          near,
          persp,
        )
        assert.ok(node >= cluster, `${k} mip ${mip}: ${node} < ${cluster}`)
      }
    }
  }
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

// A leaf a shadow view keeps is asked for in the descent's readout, laid as the camera cut's; the
// copy lands a few frames later, and the streaming reads it beside the views' readbacks, one list
// made again only when it changes (`../traversal/requests.ts`).
test('the leaves the shadow views ask for reach the streaming beside the views’ readbacks', async () => {
  const fake = fakeDevice({ limits: LIMITS })
  const res = createVsmResources(fake.device, { fullMapCapacity: 63, poolPages: 256 })
  const raster = recordingRaster(fake.device, 1000)
  const lights = [{ kind: 'directional' as const, firstId: 0, count: 17 }]
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
  const fake = fakeDevice({ limits: LIMITS })
  const res = createVsmResources(fake.device, { fullMapCapacity: 63, poolPages: 256 })
  const raster = recordingRaster(fake.device, 1000)
  const lights = [{ kind: 'directional' as const, firstId: 0, count: 17 }]
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
// alone (`heldHere`).
test('the descent lists a view for each mip of each map of a light that has a page to draw', () => {
  const descent = vsmDescentWgsl(LAYOUT)
  const work = new Array(FRAME_COUNTERS + 1 + 4).fill(0)
  // Light 0 holds maps 0 and 1 — map 0 has pages to draw in mips 0 and 2, map 1 in none —, light 1
  // the map 5, mip 0.
  const mips = new Map([
    [0, 0b101],
    [1, 0],
    [5, 0b1],
  ])
  const scope = {
    ...wgslConstants(descent),
    work,
    lights: [
      [0, 2, 0, 0],
      [5, 1, 0, 0],
    ],
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
  assert.deepEqual(work.slice(FRAME_COUNTERS + 1, FRAME_COUNTERS + 4), [0, 2 << 16, 5])
  // The views of the maps 0 to 3: the pass's own; the map 5 belongs to another.
  assert.deepEqual([0, 1, 2].map(run.heldHere), [true, true, false])
})

// The sight of a node in a shadow view (`boxSight`): none while the previous frame's pyramid is not
// kept; else, in the main pass, held for the post pass when the previous pyramid hides it in both
// layers of the map, seen when either shows it; in the post pass, gone when this frame's pyramid
// hides it in both layers, seen otherwise.
test('a node hidden by a view’s pyramid in both layers is held, then gone; shown in one, it is seen', () => {
  const descent = vsmDescentWgsl(LAYOUT)
  const C = wgslConstants(descent)
  const hidden = { static: true, dynamic: true }
  let pass = C.CUT_MAIN
  const layer = (staticLayer: boolean) => (staticLayer ? hidden.static : hidden.dynamic)
  const run = shaderRun<{ boxSight(lo: number[], hi: number[], w: number): number }>(
    descent,
    ['boxSight'],
    {
      ...C,
      cutView: { occlusion: C.OCCLUSION_TWO_PASS, cameraWorld: [0, 0, 0] },
      cutPass: () => pass,
      deformReach: 0,
      casterSphere: (_w: number, _lo: number[], _hi: number[], _r: number, high: Ref, low: Ref) => {
        high.set([0, 0, 0, 1])
        low.set([0, 0, 0])
      },
      vsmRenderPrevShift: () => [0, 0, 0],
      descentMap: () => 3,
      descentMip: () => 2,
      vsmHandleFromId: (id: number) => ({ id }),
      vsmProjectionOf: () => ({ lightKind: 1 }),
      vsmDescentBox: () => ({ center: [0, 0, 0], extent: [1, 1, 1], cull: {} }),
      vsmHiddenBefore: (...a: unknown[]) => layer(a[6] as boolean),
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
})

// With the previous frame's pyramid and tables kept, a view pass judges the nodes its first descent
// held back once its pyramid is built — the held nodes, then every level again on those seen —, lists
// the casters of the pages they hold behind the main pass's, and culls them and the records held
// back, against this frame's pyramid.
test('with the previous frame kept, the post pass of the descent follows the pyramid’s build', async () => {
  const fake = fakeDevice({ limits: LIMITS })
  const res = createVsmResources(fake.device, { fullMapCapacity: 63, poolPages: 256 })
  const raster = recordingRaster(fake.device, 1000)
  const lights = [{ kind: 'directional' as const, firstId: 0, count: 17 }]
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
