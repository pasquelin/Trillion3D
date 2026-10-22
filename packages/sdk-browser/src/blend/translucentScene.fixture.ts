// What the transparent-pass tests share: a scene of three transparent copies, one of which
// transmits, prepared and planned as `prepareBlendResources` does, and the frame targets of a
// replay.
import * as G from '../scene/host/graph/graph.fixture.ts'
import { Color } from '../../../sdk-core/src/world/math/color.ts'
import { Scene } from '../session/world/scene.ts'
import { surfaceOf, type PageSurface } from '../geometry/pages/surface.ts'
import { prepareWebgpuBlend } from './prepare.ts'
import { voidStaleBlendGroups } from './identity.ts'
import { blendLightResources } from './lighting.ts'
import { createWebgpuBlendState } from './state.ts'
import { refreshBlendPlan } from './plan/plan.ts'
import { buildBlendStatics } from './statics.ts'
import { uniformStride } from '../session/memory/pools.ts'
import { orderBlendPasses } from './order/order.ts'
import { triangleGeometry } from '../session/engine/pagesEngineScenes.fixture.ts'
import { fakeDevice } from '../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { commandArgs, type FakePass } from '../../../../tests/kit/fakeDevice/fakeRenderPass.ts'
import type { WebgpuGpuState } from '../frame/backend/state/gpu.ts'
import type { WebgpuPagesRuntime } from '../frame/backend/runtime.ts'
import { reflectionFront } from '../lighting/reflections/frontDepth.fixture.ts'
import { VERDICT_WORDS } from './verdict/verdictLayout.ts'
import { planItem } from './plan/plan.ts'
import { NO_OVERRIDES } from '../frame/backend/state/viewOverrides.ts'

const buffer = () => ({ size: 0 }) as unknown as GPUBuffer

/** A device that records every pipeline and group it builds; `pipelines` names the render
 *  pipelines by fragment entry, `groups.created` counts the bind groups. */
export function mountDevice() {
  const { device, renderPipelines, bindGroups } = fakeDevice()
  return {
    get pipelines() {
      return renderPipelines.map((pipeline) => pipeline.fragment!.entryPoint!)
    },
    /** The target formats of the render pipeline of fragment entry `entry`. */
    formats: (entry: string) =>
      [
        ...renderPipelines.find((pipeline) => pipeline.fragment!.entryPoint === entry)!.fragment!
          .targets,
      ].map((target) => target?.format),
    groups: {
      get created() {
        return bindGroups.length
      },
      /** The resource each binding of the last group names. */
      get last() {
        const entries = bindGroups.at(-1)!.entries as GPUBindGroupEntry[]
        return new Map(entries.map(({ binding, resource }) => [binding, resource]))
      },
    },
    renderPipelines,
    device,
  }
}

/** One triangle per mesh: only the material class distinguishes the three copies. */
function copy(material: PageSurface, order: number) {
  const geometry = triangleGeometry()
  const mesh = G.mesh(geometry, material)
  mesh.matrixAutoUpdate = false
  mesh.renderOrder = order
  mesh.frustumCulled = false
  return Object.assign(mesh, { surface: surfaceOf(material) })
}
function eau(transmission: number) {
  return G.physicalSurface({
    ...{ transparent: true, opacity: 0.6, side: G.FRONT_SIDE },
    transmission,
    ior: 1.33,
    thickness: 2.5,
    attenuationDistance: 6,
    attenuationColor: new Color().setRGB(0.35, 0.72, 0.68),
  })
}

/** The scene prepared on a kit device of its own, `device`, which the test draws it with. */
export function prepared() {
  const { device } = fakeDevice()
  const blendState = createWebgpuBlendState()
  const gpu = {} as unknown as WebgpuGpuState
  const copies = [
    copy(G.standardSurface({ transparent: true, opacity: 0.4 }), 0),
    copy(eau(1), 1),
    copy(G.standardSurface({ transparent: true, opacity: 0.2 }), 2),
  ]
  blendState.transmissive = prepareWebgpuBlend(copies, blendState, new Scene())
  // The scene's transparent list IS the draw list: static tables and the encode plan are built with
  // it, as `prepareBlendResources` does.
  buildBlendStatics(blendState, uniformStride())
  refreshBlendPlan(blendState)
  // The image sort posts the keys and the slots the pass encodes (the copies share one place:
  // equal keys, split by source order).
  orderBlendPasses(blendState, [0, 0, 0])
  const copied = GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
  const verdict = device.createBuffer({
    size: VERDICT_WORDS * 4,
    usage: GPUBufferUsage.STORAGE | copied,
  })
  blendState.expand = {
    buffers: { verdict },
    counts: { epoch: -1, rejected: 0, inView: 0 },
  } as never
  blendState.visibleBlend.push(...blendState.blendGpu)
  // The indirect arguments the draws read, as the kit's indirect draws do.
  blendState.argsBuffer = device.createBuffer({
    size: 4096,
    usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  Object.assign(blendState, { viewBuffer: buffer(), itemBuffer: buffer() })
  return { blendState, gpu, device }
}

/** Frame targets of the replay: the HDR image, the opaque depth and surfaces, the distortion's. */
export function targets(gpu: WebgpuGpuState) {
  const views = [{}, {}, {}, {}]
  Object.assign(gpu, {
    reflection: reflectionFront(),
    hdrView: {},
    colorView: {},
    depthView: {},
    targetSize: [8, 8],
    allocatedSize: [8, 8],
    hdrTexture: {},
    depthTexture: {},
    feedbackView: {},
    asIsShare: { view: {}, givenUpView: {} },
    surfaces: { views: () => views, lobesView: {}, width: 8, height: 8, lobes: { width: 1 } },
    backdrop: { color: {}, colorView: {}, distortion: {}, distortionView: {}, active: true },
    deferred: {
      uniform: {},
      placeholders: Object.fromEntries(
        ['bounceGrid', 'probes', 'tiles', 'fog'].map((k) => [k, {}]),
      ),
    },
  })
}
/** The pipelines of every rank and every key a replayed pass draws with. */
const anyPipelines = (): unknown => ({ at: () => ({}), lit: anyPipelines, reach: () => undefined })
/** The views pass `pass` writes, slot by slot (an empty one undefined). */
export const writesOf = (pass: FakePass) => pass.colors.map((color) => color?.view)
/**
 * A frame to replay the transparent passes into: a runtime whose bind groups are already built on
 * the placeholders — the tests observe draw order, not group construction —, encoded on the kit's
 * device (`passes`, `textureCopies` its records), and `drawn(pass)`: the ranks of the items the
 * pass plans, none when `pass` encoded no draw — every item shares one group, the GPU writing which
 * clusters each slot draws.
 */
export function replay(blendState: ReturnType<typeof prepared>['blendState'], gpu: WebgpuGpuState) {
  const { device: own, passes, textureCopies } = fakeDevice()
  // The sky light's stand-in is made on the device the frame encodes on (`skyLightReadOf`).
  Object.assign(gpu, { device: own })
  const encoder = own.createCommandEncoder()
  const drawn = (pass: FakePass) =>
    commandArgs(pass.commands, 'drawIndirect').length
      ? [...new Set(Array.from(blendState.seeds, planItem))]
      : []
  const rt = {
    // A textured scene: its pipelines write the feedback.
    vis: { blendPipelines: anyPipelines(), writesFeedback: true, materialTable: {} },
    gpu,
    capture: { capturing: false },
    lights: { buffer: {}, store: { count: 0, epoch: 0, unlit: false } },
    bounce: { probes: undefined },
    views: { active: { overrides: NO_OVERRIDES } },
    context: {},
    // `lit` view with no light: the contract lights, so the pass binds its resources by default.
    blendState,
    run: {
      diagnostic: 'beauty',
      gpuDrawCalls: 0,
      blendDrawCalls: 0,
      blendPagedTriangles: 0,
      blendSubmittedTriangles: 0,
      feedbackWritten: true,
    },
  } as unknown as WebgpuPagesRuntime
  // Groups are already built on these resources, in both identity slots: their identity is primed
  // on them, so the pass need not rebuild them — this test observes draw order, not group
  // construction. The lighting is resolved once, as `encodeBlend` does before any pass.
  voidStaleBlendGroups(rt, blendLightResources(rt))
  // The shared group is posted ahead for the same reason.
  blendState.sharedGroups[0] = blendState.sharedGroups[1] = {} as GPUBindGroup
  return { rt, encoder, passes, textureCopies, drawn }
}
