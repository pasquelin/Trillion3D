// The scene trace (`stTrace`, `sceneTraceWgsl.ts`) meets the triangles a brute force over the same
// triangles meets. A scene of a ground, turned, stretched and mirrored boxes and two-sided panels is
// compiled with its ray tracing file and opened on Dawn; once its view is held, the trace is built
// as the engine builds it — over the cut's tables and the roots in the cut's order — and 4096 rays
// are cast, one a thread: from a grid near the eye, over the view and over all directions. Each
// ray's nearest hit is compared with the oracle's (`sceneTraceOracle.ts`: every triangle of every
// placement, in doubles), then 4096 shadow rays from the ground toward the sun (the first hit, the
// front faces culled, the shadow rules) against the oracle's "is anything in the way".
//
// A ray that passes within a hair of a triangle's edge is grazing — the oracle's answer then differs
// when the triangles are grown or shrunk by 1e-4 in barycentric coordinates — and is counted, not
// compared: at most 0.5 % of the rays. The rays, the kernel and the comparisons are in
// `sceneTraceRays.ts`; the card shadows' chain is the proof `card-shadow-chain.gpu.ts`.
//
//   node bench/dawn/proofs.ts tests/gpu/rays/scene-trace.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { runOnDawn } from '../../kit/device/onDawn.ts'
import { bufferHolding } from '../../kit/device/computeReadback.ts'
import { animationFrame } from '../../kit/device/frame.ts'
import { settle } from '../world/proofWorld.ts'
import {
  ensureSceneTrace,
  type SceneTrace,
} from '../../../packages/sdk-browser/src/lighting/rays/sceneTrace/sceneTraceResources.ts'
import {
  sceneTraceBindEntries,
  sceneTraceLayoutEntries,
} from '../../../packages/sdk-browser/src/lighting/rays/sceneTrace/sceneTraceWgsl.ts'
import {
  dagReadGroupEntries,
  dagReadLayoutEntries,
} from '../../../packages/sdk-browser/src/geometry/dag/shader/bindings.ts'
import { computeBufferEntry } from '../../../packages/sdk-browser/src/gpu/core/computeBindings.ts'
import { readGpuBuffer } from '../../../packages/sdk-browser/src/gpu/core/readback.ts'
import { SURFACE_CACHE_RULES } from '../../../packages/sdk-core/src/contracts/surfaceCacheOptions.ts'
import { placeTriangles } from './sceneTraceOracle.ts'
import {
  Casts,
  GRAZING,
  KERNEL,
  RAYS,
  RAYS_BINDING,
  compareNearest,
  compareShadow,
  decode,
  nearestRays,
  shadowRays,
} from './sceneTraceRays.ts'
import { openTraceWorld, POSE } from './traceWorld.ts'

/** Casts and compares both batches on the held view of the scene. */
async function measure() {
  const { world, canvas, runtime } = await openTraceWorld()
  let trace: SceneTrace | undefined
  const buffers: GPUBuffer[] = []
  try {
    world.setPose(POSE)
    await world.awaitPages()
    if ((await settle(world, POSE)) === null) throw new Error('the view never settled')
    const rt = runtime()
    if (!rt) throw new Error('the engine built no runtime')
    // A few images more: the cut's tables are there, and the view is still.
    for (let i = 0; i < 4 || !rt.run.gpuSelection?.cutTables(); i++) {
      if (i > 60) throw new Error('the cut never published its tables')
      await animationFrame()
      world.render(POSE)
    }
    await world.flush()
    const file = rt.context.rayTracing
    if (!file)
      throw new Error(
        'the scene has no ray tracing file (rayTracing.bin): the compiler wrote none, or the session did not read it',
      )
    const cut = rt.run.gpuSelection!.cutTables()!
    const device = rt.gpu.device!
    const roots = rt.layout.selectionRoots
    const eye = Array.from(world.engine.rasterView().cam.eye)

    // The trace as the engine builds it: its placements the cut's roots, its eye the camera's. The
    // view is not culled by distance or angle: every placement is met.
    const made = ensureSceneTrace(undefined, device, file, roots.length)
    assert.ok(made.sceneTrace, `the scene trace is made: ${made.why}`)
    trace = made.sceneTrace
    trace.syncPlacements(roots, rt.run.gate.revisions.scene)
    trace.writeParams({
      eye: [eye[0], eye[1], eye[2]],
      treeRoot: cut.treeRoot,
      cullRadius: 1e6,
      cullAngle: 0,
      maxIterations: SURFACE_CACHE_RULES.surfaceCacheHardwareRayTracingMaxIterations.default,
    })

    const module = device.createShaderModule({ label: 'scene trace proof', code: KERNEL })
    const failed = (await module.getCompilationInfo()).messages.filter((m) => m.type === 'error')
    if (failed.length)
      throw new Error(
        `the proof's kernel does not compile: ${failed.map((m) => `${m.lineNum}: ${m.message}`).join('; ')}`,
      )
    const tables = device.createBindGroupLayout({ entries: dagReadLayoutEntries() })
    const own = device.createBindGroupLayout({
      entries: [
        ...sceneTraceLayoutEntries(0),
        computeBufferEntry(RAYS_BINDING, 'read-only-storage'),
        computeBufferEntry(RAYS_BINDING + 1, 'storage'),
      ],
    })
    const pipeline = await device.createComputePipelineAsync({
      layout: device.createPipelineLayout({ bindGroupLayouts: [tables, own] }),
      compute: { module, entryPoint: 'traceRays' },
    })
    const answersBytes = RAYS * 16
    const cast = async (casts: Casts) => {
      const rays = bufferHolding(device, casts.floats, GPUBufferUsage.STORAGE)
      const answers = bufferHolding(
        device,
        new Uint32Array(RAYS * 4),
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      )
      buffers.push(rays, answers)
      const encoder = device.createCommandEncoder()
      const pass = encoder.beginComputePass()
      pass.setPipeline(pipeline)
      pass.setBindGroup(
        0,
        device.createBindGroup({ layout: tables, entries: dagReadGroupEntries(cut.views) }),
      )
      pass.setBindGroup(
        1,
        device.createBindGroup({
          layout: own,
          entries: [
            ...sceneTraceBindEntries(trace!, 0),
            { binding: RAYS_BINDING, resource: { buffer: rays } },
            { binding: RAYS_BINDING + 1, resource: { buffer: answers } },
          ],
        }),
      )
      pass.dispatchWorkgroups(RAYS / 64)
      pass.end()
      device.queue.submit([encoder.finish()])
      return decode((await readGpuBuffer(device, answers, answersBytes))!)
    }

    const placed = placeTriangles(file, roots)
    const nearest = new Casts()
    nearestRays(nearest)
    const shadows = new Casts()
    shadowRays(shadows, eye)
    return {
      nearest: compareNearest(placed, nearest, await cast(nearest), eye),
      shadow: compareShadow(placed, shadows, await cast(shadows), eye),
    }
  } finally {
    trace?.dispose()
    for (const buffer of buffers) buffer.destroy()
    world.dispose()
    canvas.remove()
  }
}

let measured: ReturnType<typeof measure> | undefined
const errors: string[] = []
const results = () => (measured ??= runOnDawn(measure, null, errors))

test('the scene trace meets the nearest triangle a brute force over the same triangles meets', async () => {
  const { nearest } = await results()
  console.log(JSON.stringify({ nearest }))
  assert.deepEqual(errors, [])
  const detail = nearest.problems.join(' | ')
  assert.ok(
    nearest.hits > RAYS / 4 && nearest.misses > 0,
    'the rays must hit the scene and leave it',
  )
  assert.ok(nearest.placementsMet >= 4, 'the rays must meet several placements')
  assert.equal(nearest.incomplete, 0, 'every trace is complete')
  assert.ok(
    nearest.grazing <= RAYS * GRAZING,
    `${nearest.grazing} grazing rays, past ${GRAZING * 100} %`,
  )
  assert.equal(nearest.wrongHit, 0, `hit and miss part: ${detail}`)
  assert.ok(nearest.worstGap <= 1, `a distance off by ${nearest.worstGap} tolerances: ${detail}`)
  assert.ok(
    nearest.wrongTriangle + nearest.wrongFace <= RAYS * GRAZING,
    `${nearest.wrongTriangle} hits on another triangle, ${nearest.wrongFace} on the other face: ${detail}`,
  )
})

test('a shadow ray is blocked exactly where a brute force finds a triangle in its way', async () => {
  const { shadow } = await results()
  console.log(JSON.stringify({ shadow }))
  assert.deepEqual(errors, [])
  assert.ok(
    shadow.blocked > 0 && shadow.open > 0,
    'the sun must be blocked from some ground and not from the rest',
  )
  assert.ok(
    shadow.grazing <= RAYS * GRAZING,
    `${shadow.grazing} grazing rays, past ${GRAZING * 100} %`,
  )
  assert.equal(shadow.wrong, 0, `shadow rays that disagree: ${shadow.problems.join(' | ')}`)
})
