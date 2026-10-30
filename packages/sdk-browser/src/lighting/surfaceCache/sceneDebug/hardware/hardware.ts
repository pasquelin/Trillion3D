import { CENTIMETRES_PER_METRE } from '../../../../../../sdk-core/src/page/format.ts'
import { clamp } from '../../../../../../math/src/scalar/reals.ts'
import { waterFrontOf } from '../../../../blend/water/waterReflection.ts'
import { dagReadGroupEntries } from '../../../../geometry/dag/shader/bindings.ts'
import type { WebgpuPagesRuntime } from '../../../../frame/backend/runtime.ts'
import { skyLightReadOf } from '../../../../frame/render/skyLightState.ts'
import { startedComputeStages } from '../../../../gpu/core/computeStages.ts'
import { oncePerDevice, oncePerDeviceKey } from '../../../../gpu/core/oncePerDevice.ts'
import type { LightAtlasFormat } from '../../../../gpu/core/lightAtlasFormat.ts'
import { skyLightReadBindEntries } from '../../../../modules/sky/skyLight/read.ts'
import { sceneTraceGroupBinder } from '../../../rays/sceneTrace/sceneTraceGroup.ts'
import {
  heldMakerOf,
  oncePerDeviceOverPrograms,
  sceneMaskKey,
} from '../../../rays/sceneTrace/sceneMaskPrograms.ts'
import { stagesPending, stagesReady } from '../../../rays/sceneTrace/sceneMaskHold.ts'
import { rayFogBindEntries, rayFogReadOf } from '../../../reflections/rayFog.ts'
import { sceneRaysOf } from '../../lighting/surfaceLighting.ts'
import { surfaceHitReads } from '../../frame.ts'
import { surfaceHitCardsEntries } from '../../hitWgsl.ts'
import { surfaceCacheLightOf } from '../../light.ts'
import { VISUALIZE_LAST_USED_MODES, visualizeLabelOf, type TileRect } from '../../visualizeModes.ts'
import type { ProbeDebug } from '../probeTables.ts'
import { visualizeTonemapBindings } from '../visualizeTonemap.ts'
import {
  HARDWARE_ANSWER_BINDINGS as A,
  HARDWARE_ANSWER_ENTRY,
  HARDWARE_ANSWER_FOG,
  hardwareAnswerEntries,
  hardwareAnswerHit,
  hardwareAnswerWgsl,
} from './answerWgsl.ts'
import {
  HARDWARE_FLAG,
  HARDWARE_PARAMS,
  hardwareDispatchOf,
  hardwareParamsOf,
  hardwareRayWords,
  hardwareTileWords,
  hardwareTiles,
} from './layout.ts'
import {
  RAY_LIST_BINDINGS,
  RAY_LIST_ENTRIES,
  rayListLayoutEntries,
  rayListWgsl,
} from './rayListWgsl.ts'
import type { HardwareTarget } from './target.ts'
import {
  HARDWARE_TRACE_BINDINGS as T,
  HARDWARE_TRACE_ENTRY,
  HARDWARE_TRACE_SCENE,
  hardwareTraceEntries,
  hardwareTraceSceneEntries,
  hardwareTraceWgsl,
} from './traceWgsl.ts'

const LABEL = 'Trillion3D debug scene visualization triangles'
/** The shortest trace the view asks for, in centimetres, and the longest. */
const MIN_TRACE = 0.01
const MAX_TRACE = 1048576

const listStages = oncePerDevice((device: GPUDevice) => {
  const layout = device.createBindGroupLayout({
    label: `${LABEL} lists`,
    entries: rayListLayoutEntries(),
  })
  return {
    layout,
    stages: startedComputeStages(
      device,
      `${LABEL} lists`,
      device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      device.createShaderModule({ label: `${LABEL} lists`, code: rayListWgsl }),
      RAY_LIST_ENTRIES,
    ),
  }
})

/** The trace's kernel over the graph masks `programs` its rays cut the surfaces by. */
const traceStages = oncePerDeviceOverPrograms((device: GPUDevice, _key: 'trace', programs) => {
  const label = `${LABEL} trace ${sceneMaskKey(programs)}`
  const layouts = [
    device.createBindGroupLayout({ label, entries: hardwareTraceEntries() }),
    device.createBindGroupLayout({ label, entries: hardwareTraceSceneEntries() }),
  ]
  return {
    layouts,
    stages: startedComputeStages(
      device,
      label,
      device.createPipelineLayout({ bindGroupLayouts: layouts }),
      device.createShaderModule({ label, code: hardwareTraceWgsl(programs) }),
      [HARDWARE_TRACE_ENTRY],
    ),
  }
})

/** The maker of the trace's kernel for a device, as the mask hold takes it (`maskHold.use`): one function a device, not one an image. */
const traceMaker = heldMakerOf(traceStages)

/** The shading kernel for the format the light is stored in, the mode, and whether the draw writes the cache's feedback and the emission is compressed. */
const answerStages = oncePerDeviceKey((device: GPUDevice, key: string) => {
  const [light, mode, feedback, compressed] = key.split('|') as [
    LightAtlasFormat,
    string,
    string,
    string,
  ]
  const label = `${LABEL} answer ${key}`
  const layout = device.createBindGroupLayout({
    label,
    entries: hardwareAnswerEntries(Number(mode), light, feedback === 'true', compressed === 'true'),
  })
  return {
    layout,
    stages: startedComputeStages(
      device,
      label,
      device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      device.createShaderModule({
        label,
        code: hardwareAnswerWgsl(light, Number(mode), feedback === 'true', compressed === 'true'),
      }),
      [HARDWARE_ANSWER_ENTRY],
    ),
  }
})

/** The pass that traces the scene view through the scene's triangles: it lists the tiles and the rays of a draw, traces them, shades what they meet and lays the result over the display. */
export function createSceneHardware(device: GPUDevice, target: HardwareTarget) {
  const words = new Uint32Array(HARDWARE_PARAMS.words)
  let tiles: GPUBuffer | undefined
  let work: GPUBuffer | undefined
  const sceneGroup = sceneTraceGroupBinder(device)
  const buffer = (held: GPUBuffer | undefined, label: string, bytes: number) => {
    if (held && held.size >= bytes) return held
    held?.destroy()
    return device.createBuffer({
      label: `${LABEL} ${label}`,
      size: bytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
  }
  return {
    /**
     * Draws number `draw` of the image (the mode `mode`, over `rect` of `view`'s display of `size`, traced as far as `maxTrace` centimetres) through the triangles; false when the image cannot (the lighting made no scene trace for it,
     * the cache's lighting is not there, a kernel is still compiling) and the march of the field draws it instead.
     */
    encode(
      rt: WebgpuPagesRuntime,
      encoder: GPUCommandEncoder,
      display: GPUTextureView,
      size: readonly [number, number],
      view: ProbeDebug,
      draw: number,
      mode: number,
      rect: TileRect,
      tiled: boolean,
      maxTrace: number,
    ) {
      const { gpu } = rt
      const tone = visualizeTonemapBindings(rt)
      const deferred = gpu.deferred
      const reflection = gpu.reflection
      const lights = rt.lights.buffer
      const rays = sceneRaysOf(rt.surfaceCache?.lighting, rt.run.frame)
      if (!tone || !deferred || !reflection || !lights || !rays || !target.ready) return false
      const light = surfaceCacheLightOf(rt, device)
      const feedback = view.sceneSurfaceCacheFeedback && VISUALIZE_LAST_USED_MODES.includes(mode)
      const compressed = !!rt.surfaceCache?.atlases?.compressed
      const lists = listStages(device)
      const trace = rays.sceneTrace.maskHold.use(
        'scene debug hardware',
        '',
        traceMaker(device, 'trace'),
        stagesReady,
        stagesPending,
      )?.kernel
      const answer = answerStages(device, `${light}|${mode}|${feedback}|${compressed}`)
      if (!lists.stages.ready || !trace?.stages.ready || !answer.stages.ready) return false
      const fog = reflection.settings(rt.context, waterFrontOf(rt))
      const draws = [rect.width, rect.height] as const
      const textures = target.texturesOf(draws, true)
      const parameters = target.paramsOf(
        draw,
        hardwareParamsOf(words, {
          draw: draws,
          display: size,
          rect,
          trace: [
            clamp(view.sceneMinTrace, MIN_TRACE, 1000) / CENTIMETRES_PER_METRE,
            clamp(maxTrace, MIN_TRACE, MAX_TRACE) / CENTIMETRES_PER_METRE,
            rays.depthBias,
            rays.minHitDistance,
          ],
          flags:
            (view.sceneHiRes ? HARDWARE_FLAG.hiRes : 0) |
            (fog.heightFog ? HARDWARE_FLAG.fog : 0) |
            (tiled ? HARDWARE_FLAG.tiled : 0),
          tonemap: view.sceneToneMap && tone.baked,
          culling: view.sceneCulling,
          fogSky: fog.fogSkyDistance,
        }),
      )
      tiles = buffer(tiles, 'tiles', hardwareTileWords(draws) * 4)
      work = buffer(work, 'rays', hardwareRayWords(draws) * 4)
      encoder.clearBuffer(tiles, 0, 4)
      encoder.clearBuffer(work, 0, 4)
      const reads = surfaceHitReads(rt, device, undefined, light)
      const [across, down] = hardwareTiles(draws)
      const [dispatchX, dispatchY] = hardwareDispatchOf(draws)
      const bind = (group: GPUBindGroupLayout, entries: GPUBindGroupEntry[]) =>
        device.createBindGroup({ label: LABEL, layout: group, entries })
      const L = RAY_LIST_BINDINGS
      const listGroup = bind(lists.layout, [
        { binding: L.params, resource: { buffer: parameters } },
        { binding: L.tiles, resource: { buffer: tiles } },
        { binding: L.rays, resource: { buffer: work } },
      ])
      const traceGroup = bind(trace.layouts[0]!, [
        { binding: T.params, resource: { buffer: parameters } },
        { binding: T.rays, resource: { buffer: work } },
        { binding: T.hits, resource: textures.hits!.createView() },
        { binding: T.view, resource: { buffer: deferred.uniform } },
        ...dagReadGroupEntries(rays.views),
      ])
      const scene = sceneGroup(
        trace.layouts[HARDWARE_TRACE_SCENE.group]!,
        rays.sceneTrace,
        HARDWARE_TRACE_SCENE.first,
      )
      const fogRead = rayFogReadOf(gpu, deferred.placeholders)
      const answerGroup = bind(answer.layout, [
        { binding: A.params, resource: { buffer: parameters } },
        { binding: A.rays, resource: { buffer: work } },
        { binding: A.hits, resource: textures.hits!.createView() },
        { binding: A.radiance, resource: textures.radiance!.createView() },
        ...tone.resources.map((resource, k) => ({ binding: A.tone + k, resource })),
        ...skyLightReadBindEntries(A.sky, skyLightReadOf(rt)),
        ...surfaceHitCardsEntries(hardwareAnswerHit(mode, feedback, compressed), reads.hit),
        { binding: A.lights, resource: { buffer: lights } },
        ...rayFogBindEntries(HARDWARE_ANSWER_FOG, true, fogRead),
      ])
      const pass = encoder.beginComputePass({ label: `${LABEL} ${visualizeLabelOf(mode) ?? mode}` })
      pass.setPipeline(lists.stages.pipelineOf(RAY_LIST_ENTRIES[0]))
      pass.setBindGroup(0, listGroup)
      pass.dispatchWorkgroups(across, down)
      pass.setPipeline(lists.stages.pipelineOf(RAY_LIST_ENTRIES[1]))
      pass.dispatchWorkgroups(dispatchX, dispatchY)
      pass.setPipeline(trace.stages.pipelineOf(HARDWARE_TRACE_ENTRY))
      pass.setBindGroup(0, traceGroup)
      pass.setBindGroup(HARDWARE_TRACE_SCENE.group, scene)
      pass.dispatchWorkgroups(dispatchX, dispatchY)
      pass.setPipeline(answer.stages.pipelineOf(HARDWARE_ANSWER_ENTRY))
      pass.setBindGroup(0, answerGroup)
      pass.dispatchWorkgroups(dispatchX, dispatchY)
      pass.end()
      target.blit(encoder, display, rect, parameters)
      return true
    },
    dispose() {
      tiles?.destroy()
      work?.destroy()
    },
  }
}

/** The pass that traces the scene view through the triangles (`createSceneHardware`). */
export type SceneHardware = ReturnType<typeof createSceneHardware>
