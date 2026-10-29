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
  SCENE_VISUALIZE_HIT,
  SCENE_VISUALIZE_PARAM_WORDS,
  SCENE_VISUALIZE_SKY_LIGHT,
  sceneVisualizeWgsl,
} from './sceneVisualizeWgsl.ts'

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

/** The bind group layout and pipeline for a device and the format the light is stored in. */
const kernel = oncePerDeviceKey((device: GPUDevice, light: LightAtlasFormat) => {
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
      ...seen(surfaceHitLayoutEntries(SCENE_VISUALIZE_HIT, light)),
    ],
  })
  const module = device.createShaderModule({ label: LABEL, code: sceneVisualizeWgsl(light) })
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
})

/** The pass that draws the scene seen from the camera, its parameters and the stand-ins for what the world lacks, kept between images. */
export function createSceneVisualize(device: GPUDevice) {
  const params = new Float32Array(SCENE_VISUALIZE_PARAM_WORDS)
  const paramsBuffer = device.createBuffer({
    label: `${LABEL} parameters`,
    size: params.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
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
  const words = new Uint32Array(params.buffer)
  return {
    /** Draws the view over `target` (`size` display pixels); whether it did. */
    encode(
      rt: WebgpuPagesRuntime,
      encoder: GPUCommandEncoder,
      target: GPUTextureView,
      size: readonly [number, number],
      view: ProbeDebug,
    ) {
      const tone = visualizeTonemapBindings(rt)
      if (!tone) return false
      const source = probeSourceOf(rt)
      const light = source?.light ?? surfaceCacheLightOf(rt, device)
      const made = kernel(device, light)
      const draw = made.draw.get()
      if (!draw) return false
      const reads = surfaceHitReads(rt, device, undefined, light)
      const cache = view.sceneTraceRadianceCache && !!source
      const farSky = !!source?.skyKept
      const settings = screenProbeSettingsOf(rt)
      maps.set([0, 0, 0, 0, 0, 0, source?.resolution[0] ?? 1, source?.resolution[2] ?? 1], 0)
      device.queue.writeBuffer(mapsBuffer, 0, maps)
      params.set(
        [
          size[0],
          size[1],
          settings.values.screenProbeRadianceCacheReprojectionRadiusScale,
          0,
          clamp(view.sceneMinTrace, MIN_TRACE, 1000),
          clamp(view.sceneMaxTrace, MIN_TRACE, MAX_TRACE),
          0,
          0,
        ],
        0,
      )
      words.set(
        [
          (cache ? FLAG.cache : 0) | (view.sceneHiRes ? FLAG.hiRes : 0) | (farSky ? FLAG.sky : 0),
          view.sceneToneMap && tone.baked ? 1 : 0,
          0,
          0,
        ],
        8,
      )
      device.queue.writeBuffer(paramsBuffer, 0, params)
      if (!finals.has(light))
        finals.set(light, standInTexture(device, `${LABEL} final`, light).createView())
      const pass = encoder.beginRenderPass({
        label: LABEL,
        colorAttachments: [{ view: target, loadOp: 'load', storeOp: 'store' }],
      })
      pass.setPipeline(draw)
      pass.setBindGroup(
        0,
        device.createBindGroup({
          layout: made.layout,
          entries: [
            { binding: B.grid, resource: { buffer: source?.probes.uniform ?? grid } },
            { binding: B.table, resource: source?.probes.table ?? table },
            { binding: B.params, resource: { buffer: paramsBuffer } },
            { binding: B.maps, resource: { buffer: mapsBuffer } },
            { binding: B.final, resource: source?.final ?? finals.get(light)! },
            { binding: B.sky, resource: source?.sky ?? sky },
            ...tone.resources.map((resource, at) => ({ binding: B.tone + at, resource })),
            ...skyLightReadBindEntries(SCENE_VISUALIZE_SKY_LIGHT, skyLightReadOf(rt)),
            ...surfaceHitEntries(SCENE_VISUALIZE_HIT, reads.field, reads.hit),
          ],
        }),
      )
      pass.draw(3)
      pass.end()
      return true
    },
    dispose() {
      paramsBuffer.destroy()
      mapsBuffer.destroy()
      grid.destroy()
    },
  }
}

/** The pass that draws the scene seen from the camera (`createSceneVisualize`). */
export type SceneVisualize = ReturnType<typeof createSceneVisualize>
