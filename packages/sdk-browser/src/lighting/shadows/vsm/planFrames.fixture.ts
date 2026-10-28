// Frames of the shadow maps' CPU plan and of the passes that upload from it — the plan
// (`planVirtualShadowFrame`), the invalidation, the marking and the raster — on a recording
// device, in the engine's order (`vsmPlan.ts`, `vsmEncode.ts`), under seeded random suns, spots and
// point lights: what each frame left in the buffers it wrote, and what it asked of the device.
import { ComputeRun } from '../../../gpu/core/lazyComputePass.ts'
import { descentScene } from './recordingRaster.fixture.ts'
import { createHash } from 'node:crypto'
import type { SceneLight } from '../../../../../sdk-core/src/scene/light/contracts.ts'
import { perspectiveProjection } from '../../../../../math/src/projection/camera.ts'
import { fakeDevice } from '../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { replayWrites } from '../../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { createVsmResources } from './resources.ts'
import { createVsmFrameState } from './frameState.ts'
import { VSM_DEFAULT_MAPS } from './mapSettings.ts'
import {
  commitVirtualShadowFrame,
  finishVirtualShadowFrame,
  markVirtualShadowRendered,
  planVirtualShadowFrame,
} from './frameSetup.ts'
import { createVsmMarking, vsmCachePerPageBins, vsmPerPageFrame } from './markingPass.ts'
import {
  encodeCastInvalidation,
  endCastInvalidation,
  vsmCastMaps,
} from './invalidation/castInvalidation.ts'
import { vsmCastBoxes } from './invalidation/castBoxes.ts'
import { createCastChanges } from '../casters/castChanges.ts'
import { encodeVsmRender } from './render/renderPass.ts'

/** One frame's world: its lights, the eye (looking down −Z) and the boxes that moved. */
export interface PlanWorld {
  lights: SceneLight[]
  eye: [number, number, number]
  boxes: { min: number[]; max: number[]; moving: boolean }[]
}

/** A world of two suns, three spots and two point lights near `eye`, drawn from `random`. */
export function randomWorld(random: () => number, eye: [number, number, number]): PlanWorld {
  const around = (k: number) => eye[k] + (random() - 0.5) * 30 - (k === 2 ? 10 : 0)
  const unit = (): [number, number, number] => {
    const v = [random() - 0.5, -0.2 - random(), random() - 0.5]
    const n = Math.hypot(v[0], v[1], v[2])
    return [v[0] / n, v[1] / n, v[2] / n]
  }
  const base = {
    ...{ color: [1, 1, 1] as [number, number, number], intensity: 1, castsShadow: true },
    mobility: 'movable' as const,
  }
  const lights: SceneLight[] = []
  for (let k = 0; k < 2; k++)
    lights.push({ ...base, id: `sun${k}`, kind: 'directional', direction: unit() })
  for (let k = 0; k < 5; k++)
    lights.push({
      ...base,
      id: `lamp${k}`,
      kind: k < 3 ? 'spot' : 'point',
      position: [around(0), around(1), around(2)],
      direction: unit(),
      range: 3 + random() * 17,
      outerConeAngle: 0.3 + random() * 0.5,
      innerConeAngle: random() * 0.3,
      emitterRadius: random() < 0.5 ? 0.1 : undefined,
    })
  const boxes = Array.from({ length: 2 }, () => {
    const min = [around(0), around(1), around(2)]
    return { min, max: min.map((m) => m + 1 + random() * 3), moving: random() < 0.5 }
  })
  return { lights, eye, boxes }
}

/** A frame set of 127 maps, two suns and 256 pages on a recording device, and its frames. */
export function planFrames() {
  const fake = fakeDevice({
    limits: { maxStorageBufferBindingSize: 1 << 27, maxBufferSize: 1 << 27 },
  })
  const { device } = fake
  const encoder = device.createCommandEncoder()
  const res = createVsmResources(device, {
    coverMode: 'suns',
    fullMapCapacity: 127,
    sunMapCapacity: 35,
    poolPages: 256,
  })
  const state = createVsmFrameState(device, res)
  const marking = createVsmMarking(device, res)
  // The engine's per-page entries, built as `vsmEncode.ts` builds them.
  const perPage = vsmPerPageFrame()
  const rows = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const table = {} as GPUTextureView
  // The list the CPU's boxes join (`vsmEncode.ts`), no diff appending to it.
  const casts = createCastChanges(device)
  // The shadow page group the engine keeps (`shadowPageGroup`): the same every frame.
  const pageLayout = {} as GPUBindGroupLayout,
    pageGroup = {} as GPUBindGroup
  const projection = perspectiveProjection(new Float64Array(16), 60, 4 / 3, 0.1, 1)
  /** Each buffer's bytes as the writes so far left them. */
  const contents = new Map<GPUBuffer, Uint8Array<ArrayBuffer>>()
  /** The scene frame the next plan counts lights' moves in. */
  let scene = 0

  /** Plans and encodes one frame of `world`; returns the plan, the writes and the groups it
   *  made. */
  function frame(world: PlanWorld) {
    const { eye } = world
    const groupsBefore = fake.bindGroups.length
    const view = new Float64Array([
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      -eye[0],
      -eye[1],
      -eye[2],
      1,
    ])
    const boxes = world.boxes
    const changed = vsmCastBoxes(state.cache, { count: () => boxes.length, read: (b) => boxes[b] })
    const maps = vsmCastMaps(state.cache, changed, casts)
    const prevSlots = state.cache.prevFrame?.mapCount ?? 0
    const camera = { view, projection, eye, perspective: true }
    const lights = world.lights.map((light) => ({ light }))
    state.maps = { ...VSM_DEFAULT_MAPS, frame: scene++ }
    const plan = planVirtualShadowFrame(state, lights, camera, { width: 800, height: 600 })
    if (plan.overflow) throw new Error('planFrames: the tables overflowed')
    commitVirtualShadowFrame(state, plan)
    const steps = new ComputeRun().begin(encoder)
    encodeCastInvalidation(steps, res, device, prevSlots, maps, changed, casts, false)
    steps.end()
    endCastInvalidation(encoder, casts)
    marking.encode(encoder.beginComputePass(), {
      mapCount: plan.projectionCount,
      claimed: plan.claimedCount,
      singleMaps: plan.singleCount,
      perspective: true,
      perPage: vsmCachePerPageBins(state.cache, perPage),
    })
    encodeVsmRender(
      encoder,
      res,
      { device, lights: plan.lights },
      {
        rowCount: 5000,
        recordCapacity: 65536,
        ...{ packedPages: 5000, pageCount: 5000 },
        descent: descentScene(table),
        ...{ info: rows, rootWords: rows, rootBoxes: rows, casters: rows },
        decode: () => {},
        world: { cold: table, frames: table, clusters: table, worlds: table },
        pageLayout,
        pageGroup,
        tiers: { twoSided: false, voxels: false },
        multipassViews: true,
        camera: { eye, view, threshold: 1 },
      },
    )
    markVirtualShadowRendered(plan, plan.lights)
    finishVirtualShadowFrame(state, plan)
    res.swapFrames()
    const writes = fake.writes.splice(0)
    for (const write of writes) {
      let bytes = contents.get(write.buffer)
      if (!bytes) contents.set(write.buffer, (bytes = new Uint8Array(write.buffer.size)))
      replayWrites(bytes.buffer, [write])
    }
    return { plan, writes, groups: fake.bindGroups.slice(groupsBefore) }
  }

  /** SHA-256 of every written buffer's bytes, by label then creation order. */
  function digest() {
    const hash = createHash('sha256')
    const made = fake.buffers as unknown as GPUBuffer[]
    const order = [...contents.keys()].sort(
      (a, b) => (a.label ?? '').localeCompare(b.label ?? '') || made.indexOf(a) - made.indexOf(b),
    )
    for (const buffer of order) hash.update(`${buffer.label}:`).update(contents.get(buffer)!)
    return hash.digest('hex')
  }
  return { fake, res, state, frame, digest }
}
