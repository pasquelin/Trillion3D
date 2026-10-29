import { CENTIMETRES_PER_METRE } from '../../../../../sdk-core/src/page/format.ts'
import { clamp } from '../../../../../math/src/scalar/reals.ts'
import { standInBuffer, standInTexture } from '../../../gpu/core/standIns.ts'
import { computeBufferEntry, computeTextureEntry } from '../../../gpu/core/computeBindings.ts'
import { lightAtlasSampleType, type LightAtlasFormat } from '../../../gpu/core/lightAtlasFormat.ts'
import { oncePerDeviceKey } from '../../../gpu/core/oncePerDevice.ts'
import { preparedPipeline } from '../../deferred/fullscreen.ts'
import { toneReadEntries } from '../../toneLutRead.ts'
import { DISPLAY_FORMAT } from '../../../scene/targetFormats.ts'
import { skyLightReadOf } from '../../../frame/render/skyLightState.ts'
import {
  skyLightReadBindEntries,
  skyLightReadLayoutEntries,
} from '../../../modules/sky/skyLight/read.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { atlasEntry } from '../../bounce/atlas.ts'
import { BOUNCE_GRID_BYTES } from '../../bounce/uniform.ts'
import { screenProbeSettingsOf } from '../../bounce/screen/settingsOf.ts'
import { surfaceHitEntries, surfaceHitLayoutEntries } from '../hitWgsl.ts'
import { surfaceHitReads } from '../frame.ts'
import { surfaceCacheLightOf } from '../light.ts'
import { probeSourceOf } from './radianceProbes.ts'
import type { ProbeDebug } from './probeTables.ts'
import { visualizeTonemapBindings } from './visualizeTonemap.ts'
import {
  SCENE_VISUALIZE_BINDINGS as B,
  SCENE_VISUALIZE_FLAG as FLAG,
  SCENE_VISUALIZE_FOG,
  SCENE_VISUALIZE_LIGHTS,
  SCENE_VISUALIZE_PARAM_WORDS,
  SCENE_VISUALIZE_SKY_LIGHT,
  sceneVisualizeHit,
  sceneVisualizeWgsl,
} from './sceneVisualizeWgsl.ts'
import { rayFogBindEntries, rayFogLayoutEntries, rayFogReadOf } from '../../reflections/rayFog.ts'
import { waterFrontOf } from '../../../blend/water/waterReflection.ts'
import {
  VISUALIZE_LAST_USED_MODES,
  VISUALIZE_MODE,
  visualizeDrawsOf,
  visualizeLabelOf,
  visualizeTracesScene,
  tileRectOf,
  OVERVIEW_TILE_MARGIN,
} from '../visualizeModes.ts'
import { TEXT_LINE } from '../../../diagnostic/textOverlay.ts'

/**
 * THE SCENE SEEN FROM THE CAMERA (`scene-visualization`, `sceneVisualizeWgsl.ts`): one full-screen draw over the display image, every pixel its own ray. The world's probes it
 * reads past the near trace are those the sphere view draws (`probeSourceOf`); where the world has none, or the view does not ask for them, a stand-in is bound and the trace
 * runs the whole distance.
 */

const LABEL = 'Trillion3D debug scene visualization'
/** The stage the draw reads in. */
const FRAGMENT = 2
/** The shortest trace the view asks for, in centimetres, and the least a trace may start at. */
const MIN_TRACE = 0.01
/** The farthest the trace of the reference goes, half of the world's size. */
const MAX_TRACE = 1048576

/** The bind group layout and pipeline for a device, the format the light is stored in, the scene view's mode and whether the draw writes the cache's feedback. */
const kernelOf = oncePerDeviceKey((device: GPUDevice, key: string) => {
  const [light, mode, feedback, compressed] = key.split('|') as [
    LightAtlasFormat,
    string,
    string,
    string,
  ]
  return makeKernel(device, light, Number(mode), feedback === 'true', compressed === 'true')
})
const kernel = (
  device: GPUDevice,
  light: LightAtlasFormat,
  mode: number,
  feedback: boolean,
  compressed: boolean,
) => kernelOf(device, `${light}|${mode}|${feedback}|${compressed}`)

function makeKernel(
  device: GPUDevice,
  light: LightAtlasFormat,
  mode: number,
  feedback: boolean,
  compressed: boolean,
) {
  const seen = (entries: GPUBindGroupLayoutEntry[]) =>
    entries.map((entry) => ({ ...entry, visibility: entry.visibility | FRAGMENT }))
  const layout = device.createBindGroupLayout({
    label: LABEL,
    entries: [
      computeBufferEntry(B.grid, 'uniform', FRAGMENT),
      ...seen([atlasEntry(B.table)]),
      computeBufferEntry(B.params, 'uniform', FRAGMENT),
      computeBufferEntry(B.maps, 'uniform', FRAGMENT),
      computeTextureEntry(B.final, lightAtlasSampleType(light), '2d', FRAGMENT),
      computeTextureEntry(B.sky, 'unfilterable-float', '2d', FRAGMENT),
      computeBufferEntry(B.tone, 'uniform', FRAGMENT),
      ...toneReadEntries(B.tone + 1, FRAGMENT),
      ...skyLightReadLayoutEntries(SCENE_VISUALIZE_SKY_LIGHT, FRAGMENT),
      ...seen(surfaceHitLayoutEntries(sceneVisualizeHit(mode, feedback, compressed), light)),
      computeBufferEntry(SCENE_VISUALIZE_LIGHTS, 'read-only-storage', FRAGMENT),
      ...seen(rayFogLayoutEntries(SCENE_VISUALIZE_FOG, true)),
    ],
  })
  const module = device.createShaderModule({
    label: LABEL,
    code: sceneVisualizeWgsl(light, mode, feedback, compressed),
  })
  return {
    layout,
    draw: preparedPipeline(device, {
      label: LABEL,
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: { module, entryPoint: 'fullscreen' },
      fragment: { module, entryPoint: 'sceneVisualizeFs', targets: [{ format: DISPLAY_FORMAT }] },
      primitive: { topology: 'triangle-list' },
    }).ask(),
  }
}

/** A line of text the draw asks to be written over the image: at the pixel `x`, `y` (display pixels). */
export interface SceneLabel {
  readonly text: string
  readonly x: number
  readonly y: number
}

/** The pixels the label sits from the foot of its tile. */
const LABEL_FOOT = 20

/** The pass that draws the scene seen from the camera, its parameters and the stand-ins for what the world lacks, kept between images. */
export function createSceneVisualize(device: GPUDevice) {
  const params = new Float32Array(SCENE_VISUALIZE_PARAM_WORDS)
  const words = new Uint32Array(params.buffer)
  // A draw each of a tile of the overview: its own parameters.
  const paramsBuffers: GPUBuffer[] = []
  const paramsOf = (draw: number) =>
    (paramsBuffers[draw] ??= device.createBuffer({
      label: `${LABEL} parameters ${draw}`,
      size: params.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    }))
  const mapsBuffer = device.createBuffer({
    label: `${LABEL} maps`,
    size: 48,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const grid = standInBuffer(device, `${LABEL} levels`, BOUNCE_GRID_BYTES, GPUBufferUsage.UNIFORM)
  const table = standInTexture(device, `${LABEL} table`, 'rgba32float').createView({
    dimension: '2d-array',
  })
  const sky = standInTexture(device, `${LABEL} sky`, 'r32float').createView()
  const finals = new Map<LightAtlasFormat, GPUTextureView>()
  const maps = new Float32Array(12)
  return {
    /** Draws the view over `target` (`size` display pixels), the tiles of the overview mode one after the other; the labels to write over it, none where it could not draw. */
    encode(
      rt: WebgpuPagesRuntime,
      encoder: GPUCommandEncoder,
      target: GPUTextureView,
      size: readonly [number, number],
      view: ProbeDebug,
    ): SceneLabel[] {
      const labels: SceneLabel[] = []
      const tone = visualizeTonemapBindings(rt)
      const deferred = rt.gpu.deferred
      const reflection = rt.gpu.reflection
      const lights = rt.lights.buffer
      if (!tone || !deferred || !reflection || !lights) return labels
      const source = probeSourceOf(rt)
      const light = source?.light ?? surfaceCacheLightOf(rt, device)
      const reads = surfaceHitReads(rt, device, undefined, light)
      const cache = view.sceneTraceRadianceCache && !!source
      const farSky = !!source?.skyKept
      const settings = screenProbeSettingsOf(rt)
      const fog = reflection.settings(rt.context, waterFrontOf(rt))
      const fogRead = rayFogReadOf(rt.gpu, deferred.placeholders)
      maps.set([0, 0, 0, 0, 0, 0, source?.resolution[0] ?? 1, source?.resolution[2] ?? 1], 0)
      device.queue.writeBuffer(mapsBuffer, 0, maps)
      if (!finals.has(light))
        finals.set(light, standInTexture(device, `${LABEL} final`, light).createView())
      const compressed = !!rt.surfaceCache?.atlases?.compressed
      const draws = visualizeDrawsOf(view.sceneMode)
      let pass: GPURenderPassEncoder | undefined
      draws.forEach((each, at) => {
        const rect = tileRectOf(size, each.tile, each.perRow)
        const tiled = each.tile >= 0
        const label = visualizeLabelOf(each.mode)
        if (label)
          label.split('\n').forEach((text, line) =>
            labels.push({
              text,
              x: rect.x + 2 * OVERVIEW_TILE_MARGIN,
              y: rect.y + rect.height - LABEL_FOOT + line * TEXT_LINE,
            }),
          )
        if (!visualizeTracesScene(each.mode)) return
        const feedback =
          view.sceneSurfaceCacheFeedback && VISUALIZE_LAST_USED_MODES.includes(each.mode)
        const made = kernel(device, light, each.mode, feedback, compressed)
        const draw = made.draw.get()
        if (!draw) return
        // The reflection view traces as far as the reflections do.
        const maxTrace =
          each.mode === VISUALIZE_MODE.reflectionView
            ? settings.values.screenProbeMaxTraceDistance * CENTIMETRES_PER_METRE
            : view.sceneMaxTrace
        params.set(
          [
            size[0],
            size[1],
            settings.values.screenProbeRadianceCacheReprojectionRadiusScale,
            fog.fogSkyDistance,
            clamp(view.sceneMinTrace, MIN_TRACE, 1000),
            clamp(maxTrace, MIN_TRACE, MAX_TRACE),
            0,
            0,
            rect.x,
            rect.y,
            rect.width,
            rect.height,
          ],
          0,
        )
        words.set(
          [
            (cache ? FLAG.cache : 0) |
              (view.sceneHiRes ? FLAG.hiRes : 0) |
              (farSky ? FLAG.sky : 0) |
              (fog.heightFog ? FLAG.fog : 0) |
              (tiled ? FLAG.tiled : 0),
            view.sceneToneMap && tone.baked ? 1 : 0,
            0,
            0,
          ],
          12,
        )
        device.queue.writeBuffer(paramsOf(at), 0, params)
        pass ??= encoder.beginRenderPass({
          label: LABEL,
          colorAttachments: [{ view: target, loadOp: 'load', storeOp: 'store' }],
        })
        pass.setViewport(rect.x, rect.y, rect.width, rect.height, 0, 1)
        pass.setScissorRect(rect.x, rect.y, rect.width, rect.height)
        pass.setPipeline(draw)
        pass.setBindGroup(
          0,
          device.createBindGroup({
            layout: made.layout,
            entries: [
              { binding: B.grid, resource: { buffer: source?.probes.uniform ?? grid } },
              { binding: B.table, resource: source?.probes.table ?? table },
              { binding: B.params, resource: { buffer: paramsOf(at) } },
              { binding: B.maps, resource: { buffer: mapsBuffer } },
              { binding: B.final, resource: source?.final ?? finals.get(light)! },
              { binding: B.sky, resource: source?.sky ?? sky },
              ...tone.resources.map((resource, k) => ({ binding: B.tone + k, resource })),
              ...skyLightReadBindEntries(SCENE_VISUALIZE_SKY_LIGHT, skyLightReadOf(rt)),
              ...surfaceHitEntries(
                sceneVisualizeHit(each.mode, feedback, compressed),
                reads.field,
                reads.hit,
              ),
              { binding: SCENE_VISUALIZE_LIGHTS, resource: { buffer: lights } },
              ...rayFogBindEntries(SCENE_VISUALIZE_FOG, true, fogRead),
            ],
          }),
        )
        pass.draw(3)
      })
      pass?.end()
      return labels
    },
    dispose() {
      for (const buffer of paramsBuffers) buffer.destroy()
      mapsBuffer.destroy()
      grid.destroy()
    },
  }
}

/** The pass that draws the scene seen from the camera (`createSceneVisualize`). */
export type SceneVisualize = ReturnType<typeof createSceneVisualize>
