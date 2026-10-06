import * as G from '../../host/graph/graph.fixture.ts'
import { surfaceOf } from '../../page/surface.ts'
import { prepareWebgpuBlend } from '../blend/prepare.ts'
import { voidStaleBlendGroups } from '../blend/identity.ts'
import { blendLightResources } from '../blend/lighting.ts'
import { createWebgpuBlendState } from '../blend/state.ts'
import { VOLUME_WORDS } from '../transparent/transmission.ts'
import { buildBlendStatics, refreshBlendPlan } from '../blend/plan.ts'
import { orderBlendPasses } from '../blend/order.ts'
import { triangleGeometry } from '../../backend/pagesBackendScenes.fixture.ts'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import type { WebgpuGpuState } from '../pages/state/gpu.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'

/** What the water-pass tests share: a scene of three transparent copies, one of which transmits,
 *  prepared and planned as `prepareBlendResources` does, and the frame targets of a replay. */
installGpuGlobals()
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
export const device = mountDevice().device

/** One triangle per mesh: only the material class distinguishes the three copies. */
function copy(material: G.GraphSurface, order: number) {
  const geometry = triangleGeometry()
  const mesh = G.mesh(geometry, material)
  mesh.matrixAutoUpdate = false
  mesh.renderOrder = order
  mesh.frustumCulled = false
  return Object.assign(mesh, { surface: surfaceOf(material) })
}

function eau(transmission: number) {
  return Object.assign(G.physicalSurface({ transparent: true, opacity: 0.6, side: G.FRONT_SIDE }), {
    transmission,
    ior: 1.33,
    thickness: 2.5,
    attenuationDistance: 6,
    attenuationColor: new G.Color().setRGB(0.35, 0.72, 0.68),
  })
}

export function prepared() {
  const blendState = createWebgpuBlendState()
  const gpu = {
    positionBuffers: new Map(),
    blendIndexBuffers: new Map(),
    blendUvBuffers: new Map(),
    blendNormalBuffers: new Map(),
    vertexBytes: 0,
    volumeBuffer: buffer(),
  } as unknown as WebgpuGpuState
  const copies = [
    copy(G.standardSurface({ transparent: true, opacity: 0.4 }), 0),
    copy(eau(1), 1),
    copy(G.standardSurface({ transparent: true, opacity: 0.2 }), 2),
  ]
  blendState.transmissive = prepareWebgpuBlend(device, copies, gpu, blendState, new G.Scene())
  // The scene's transparent list IS the draw list: static tables and the encode plan are built with
  // it, as `prepareBlendResources` does.
  buildBlendStatics(blendState)
  refreshBlendPlan(blendState)
  // The image sort posts the keys, the frustum verdict and the slices the pass encodes.
  // The three copies are at the same place: their keys are equal, and source order splits them.
  orderBlendPasses(blendState, [0, 0, 0])
  blendState.visibleBlend.push(...blendState.blendGpu)
  blendState.volumePacked = new Float32Array(blendState.transmissive * VOLUME_WORDS)
  blendState.argsBuffer = buffer()
  blendState.viewBuffer = buffer()
  return { blendState, gpu }
}

/** Frame targets of the replay: the HDR image, the opaque depth and surfaces, the backdrop. */
export function targets(gpu: WebgpuGpuState) {
  const placeholder = () => ({})
  const views = [{}, {}, {}, {}]
  Object.assign(gpu, {
    hdrView: {},
    colorView: {},
    depthView: {},
    targetSize: [8, 8],
    allocatedSize: [8, 8],
    hdrTexture: {},
    depthTexture: {},
    feedbackView: {},
    asIsShare: { view: {} },
    surfaces: { views: () => views },
    backdrop: { color: {}, colorView: {}, waterDepth: {}, waterDepthView: {}, active: true },
    deferred: {
      uniform: {},
      placeholders: Object.fromEntries(
        ['bounceGrid', 'probes', 'tiles', 'proxy', 'surfaceCache'].map((k) => [k, placeholder()]),
      ),
    },
  })
}

/** One pass as the replay records it. */
const recordOf = (descriptor: GPURenderPassDescriptor) => ({
  label: descriptor.label!,
  drawn: [] as number[],
  writes: [...descriptor.colorAttachments].map((attachment) => attachment?.view),
  // The frame rewrites its descriptors in place: kept as they were when the pass began.
  descriptor: structuredClone(descriptor),
  scissors: [] as number[][],
  commands: [] as string[],
})

/** The pipelines of every rank and every key a replayed pass draws with. */
const anyPipelines = (): unknown => ({ at: () => ({}), lit: anyPipelines, reach: () => undefined })
/**
 * A frame to replay the transparent passes into: a runtime whose bind groups are already built
 * on the placeholders — the tests observe draw order, not group construction —, and a recording
 * encoder that keeps each pass's label, the views it writes, the items it set, its descriptor as
 * begun, its scissors and its commands (`pipeline:<fragment entry>`, `draw`, `indirect`), and the
 * texture copies, counted and as made.
 */
export function replay(blendState: ReturnType<typeof prepared>['blendState'], gpu: WebgpuGpuState) {
  const passes: ReturnType<typeof recordOf>[] = []
  const items = blendState.blendGpu
  const counters = { copies: 0 },
    copies: unknown[] = []
  const encoder = {
    beginRenderPass: (descriptor: GPURenderPassDescriptor) => {
      const { drawn, scissors, commands } = passes[passes.push(recordOf(descriptor)) - 1]
      return {
        setViewport() {},
        setScissorRect: (...rect: number[]) => scissors.push(rect),
        setBindGroup(_slot: number, group: GPUBindGroup) {
          const rank = items.findIndex((item) => item.groups?.includes(group))
          if (rank >= 0) drawn.push(rank)
        },
        setPipeline: (p: GPURenderPipelineDescriptor) =>
          commands.push(`pipeline:${p.fragment?.entryPoint}`),
        draw: () => commands.push('draw'),
        drawIndirect: () => commands.push('indirect'),
        end() {},
      }
    },
    copyTextureToTexture: (a: unknown, b: unknown, size: unknown) => {
      counters.copies++
      copies.push(structuredClone({ a, b, size }))
    },
  } as unknown as GPUCommandEncoder
  const rt = {
    // A textured scene: its pipelines write the feedback.
    vis: { visEnabled: true, blendPipelines: anyPipelines(), writesFeedback: true },
    gpu,
    capture: { capturing: false },
    lights: { buffer: {}, store: { count: 0, unlit: false } },
    bounce: { probes: undefined },
    // `lit` view with no light: the contract lights, so the pass binds its resources by default.
    blendState,
    run: {
      diagnostic: 'beauty',
      gpuDrawCalls: 0,
      blendDrawCalls: 0,
      blendUnpagedTriangles: 0,
      blendPagedTriangles: 0,
      blendSubmittedTriangles: 0,
      feedbackWritten: true,
    },
  } as unknown as WebgpuPagesRuntime
  // Groups are already built on these resources, in both identity slots: their identity is primed
  // on them, so the pass need not rebuild them — this test observes draw order, not group
  // construction. The lighting is resolved once, as `encodeBlend` does before any pass.
  voidStaleBlendGroups(rt, blendLightResources(rt))
  for (const item of items) item.groups = [{} as GPUBindGroup, {} as GPUBindGroup]
  // No paged item here, and the shared group is posted ahead for the same reason.
  blendState.pagedGroups[0] = blendState.pagedGroups[1] = {} as GPUBindGroup
  return { rt, encoder, passes, counters, copies }
}
