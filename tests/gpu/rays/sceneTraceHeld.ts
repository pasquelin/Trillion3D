// The scene trace proof's held view: a scene opened on Dawn at its pose, the trace built as the engine builds it (over
// the cut's tables and the roots in the cut's order), the oracle's triangles placed, and the casting of a batch of rays
// on the GPU. `measure` runs the batches of a proof on it (`scene-trace.gpu.ts`).
import assert from 'node:assert/strict'
import { bufferHolding } from '../../kit/device/computeReadback.ts'
import { animationFrame } from '../../kit/device/frame.ts'
import { settle } from '../world/proofWorld.ts'
import {
  unsettledMask,
  unsettledReasons,
} from '../../../packages/sdk-browser/src/frame/loop/unsettled.ts'
import { everyImageTerms } from '../../../packages/sdk-browser/src/frame/loop/everyImage.ts'
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
import { cacheRootsOf } from '../../../packages/sdk-browser/src/lighting/surfaceCache/placements.ts'
import { SURFACE_CACHE_RULES } from '../../../packages/sdk-core/src/contracts/surfaceCacheOptions.ts'
import type { GpuSelection } from '../../../packages/sdk-browser/src/gpu/core/selection.ts'
import { placeTriangles } from './sceneTraceOracle.ts'
import { ANSWER_WORDS, type Casts, KERNEL, RAYS, RAYS_BINDING } from './sceneTraceRays.ts'
import { decode } from './sceneTraceCompare.ts'
import { HLOD_POSE, openTraceWorld, POSE } from './traceWorld.ts'

/** What the batches are given: the cast of a batch of rays, the oracle's triangles, the eye, the trace's view and the trace. */
export interface Held {
  cast: (casts: Casts) => Promise<ReturnType<typeof decode>>
  placed: ReturnType<typeof placeTriangles>
  eye: number[]
  /** The view's words but the distances under which a ray passes a near hit, each batch's own. */
  view: Omit<
    Parameters<SceneTrace['writeParams']>[0],
    'skipBackFaceDistance' | 'skipTwoSidedDistance'
  >
  trace: SceneTrace
}

/** Whether the cut draws the actor of some HLOD cell of some instance of its world DAG this frame. */
function drawsAnActor(selection: GpuSelection | undefined) {
  const states = selection?.cellStates
  if (!selection?.world || !states) return false
  for (let k = 0; k < states.instances; k++)
    for (let cell = 0; cell < states.cells; cell++) if (selection.world.draws(k, cell)) return true
  return false
}

/** The scene `scene` opened and held at its pose, the trace built as the engine builds it, and `batches` run on it:
 *  casts and compares the batches on the held view. */
export async function measure<T>(scene: 'plain' | 'hlod', batches: (held: Held) => Promise<T>) {
  const pose = scene === 'hlod' ? HLOD_POSE : POSE
  const { world, canvas, runtime } = await openTraceWorld({}, scene)
  let trace: SceneTrace | undefined
  const buffers: GPUBuffer[] = []
  try {
    world.setPose(pose)
    await world.awaitPages()
    if ((await settle(world, pose)) === null) {
      // What keeps it drawing, named: the unsettled terms, the terms drawn every image, and whether the view stands.
      const rt = runtime()
      const why = rt && {
        unsettled: unsettledReasons(unsettledMask(rt, rt.run.frame)),
        everyImage: everyImageTerms(rt),
        standing: rt.run.gate.held(),
      }
      throw new Error(`the view never settled: ${JSON.stringify(why)}`)
    }
    const rt = runtime()
    if (!rt) throw new Error('the engine built no runtime')
    // A few images more: the cut's tables are there, and the view is still; the HLOD scene's actors wait on their
    // warm-up before the cut draws them.
    for (
      let i = 0;
      i < 4 ||
      !rt.run.gpuSelection?.cutTables() ||
      (scene === 'hlod' && !drawsAnActor(rt.run.gpuSelection));
      i++
    ) {
      if (i > 240)
        throw new Error('the cut never published its tables, or never drew an HLOD actor')
      await animationFrame()
      world.render(pose)
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
    if ((scene === 'hlod') !== (file.world !== undefined))
      throw new Error(
        `the ${scene} scene's file ${file.world === undefined ? 'has no' : 'has a'} world directory`,
      )
    const eye = Array.from(world.engine.rasterView().cam.eye)

    // The trace as the engine builds it: its placements the cut's roots, its eye the camera's. The
    // view is not culled by distance or angle (mode 0, and the culling pass is not run): every placement is met.
    const selection = rt.run.gpuSelection!
    const made = ensureSceneTrace(undefined, device, file, roots.length, selection)
    assert.ok(made.sceneTrace, `the scene trace is made: ${made.why}`)
    trace = made.sceneTrace
    trace.syncPlacements(roots, selection, cacheRootsOf(rt))
    const view = {
      eye: [eye[0], eye[1], eye[2]] as const,
      treeRoot: cut.treeRoot,
      culling: {
        mode: 0,
        radius: 0,
        angle: 0,
        useDistanceToBox: false,
        useMinDrawDistance: false,
        direction: [0, 0, -1] as const,
        viewDistanceScale: 1,
        instanceDrawDistance: false,
      },
      maxIterations: SURFACE_CACHE_RULES.surfaceCacheHardwareRayTracingMaxIterations.default,
      skipsTranslucentSections:
        SURFACE_CACHE_RULES.surfaceCacheHardwareRayTracingMeshSectionVisibilityTest.default,
    }
    trace.writeParams({ ...view, skipBackFaceDistance: 0, skipTwoSidedDistance: 0 })

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
    const answersBytes = RAYS * ANSWER_WORDS * 4
    const cast = async (casts: Casts) => {
      const rays = bufferHolding(device, casts.floats, GPUBufferUsage.STORAGE)
      const answers = bufferHolding(
        device,
        new Uint32Array(RAYS * ANSWER_WORDS),
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

    // Where the cut packs a world DAG, the actors of the cells it draws are the oracle's too, taken from their own records,
    // their objects from the stand-ins the surface cache follows.
    const placed = placeTriangles(file, roots, selection.world, cacheRootsOf(rt))
    return await batches({ cast, placed, eye, view, trace })
  } finally {
    trace?.dispose()
    for (const buffer of buffers) buffer.destroy()
    world.dispose()
    canvas.remove()
  }
}
