/**
 * THE LIGHT COMPLEXITY VIEW OF A RUNTIME (`sampledLightsVisualizeLightComplexity`): what the sampling's replay left (`replay.ts`) read back a few frames late and drawn over the display image, and the
 * heat map of the cost of sampling. The list is written as text and as lines from the pixel to each light (`symbols.ts`), the light the cursor selects in orange (`list.ts`), through the text
 * and lines the sampled lighting's other debug views draw (`../frame.ts`). The heat map is a screen pass over a copy of the image. The state is made when the view first asks.
 */
import { hypot3 } from '../../../../../../math/src/float/hypot.ts'
import { wgslModule } from '../../../../../../math/src/wgsl/assemble.ts'
import type { EngineCamera } from '../../../../camera/engineCamera.ts'
import {
  screenPassGroup,
  screenPassPipeline,
  drawScreenPass,
} from '../../../../diagnostic/screenPass.ts'
import { TEXT_LINE } from '../../../../diagnostic/textOverlay.ts'
import type { WebgpuPagesRuntime } from '../../../../frame/backend/runtime.ts'
import { retire } from '../../../../gpu/core/frameRetire.ts'
import { releaseSized, sizedTexture, type SizedTexture } from '../../../../gpu/core/sizedTexture.ts'
import { createReadbackRing, type ReadbackRing } from '../../../../gpu/core/readbackRing.ts'
import { DEBUG_COLORS, debugColor, type DebugLines } from '../../../../hair/debugLines.ts'
import { DISPLAY_FORMAT } from '../../../../scene/targetFormats.ts'
import type { SampledLightsSettings } from '../../parameters.ts'
import { debugCursor } from '../cursor.ts'
import { COMPLEXITY, complexityDrawn, complexityTargetOf } from '../modes.ts'
import {
  COMPLEXITY_KIND,
  COMPLEXITY_RESULT_BYTES,
  COMPLEXITY_RESULT_WORDS,
  decodeComplexity,
  type ComplexityLight,
  type ComplexityList,
} from './entries.ts'
import { COMPLEXITY_COST_FORMAT, type ComplexityRequest } from './replay.ts'
import { HEATMAP_BLOCK_WORDS, HEATMAP_ENTRY, HEATMAP_WGSL } from './costWgsl.ts'
import {
  dumpText,
  headerRows,
  LIGHT_SYMBOL_SIZE,
  listOrigin,
  rowPrefix,
  selectedLight,
} from './list.ts'
import { cameraAxes, rectSymbol, sphereSymbol, spotSymbol } from './symbols.ts'

/** `GPUShaderStage.FRAGMENT`, written in the clear. */
const FRAGMENT = 2

/** What the view says of an input whose weighing it does not replay yet. */
const NOT_DRAWN = 'Light complexity: this input is not drawn yet'

/** The readback's staging buffers: one in flight while the next is written. */
const READBACKS = 3
/** The length, in metres, of the line to a directional light. */
const DIRECTION_LENGTH = 1000
/** The dark green of a light not seen, and the green of one seen, where the lights are not in their colours. */
const NOT_SEEN = [0.25, 0.5, 0.25] as const
const SEEN = [0, 1, 0] as const

interface ComplexityState {
  readonly result: GPUBuffer
  readonly ring: ReadbackRing
  readonly words: Uint32Array
  /** What the view shows: the last list that landed, or, frozen, the one kept. */
  list?: ComplexityList
  freeze: boolean
  dumpPending: boolean
  dumpAsked: boolean
  /** The image the replay was asked for, and the image the cost was. */
  replayed: number
  costed: number
  cost?: SizedTexture
  scene?: SizedTexture
  heat?: {
    pipeline: ReturnType<typeof screenPassPipeline>
    block: GPUBuffer
  }
}
const states = new WeakMap<WebgpuPagesRuntime, ComplexityState>()

const stateOf = (rt: WebgpuPagesRuntime, device: GPUDevice): ComplexityState => {
  const state = states.get(rt)
  if (state) return state
  const words = new Uint32Array(COMPLEXITY_RESULT_WORDS)
  const made: ComplexityState = {
    result: device.createBuffer({
      label: 'Trillion3D light complexity result',
      size: COMPLEXITY_RESULT_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    }),
    ring: createReadbackRing(
      device,
      {
        label: 'Trillion3D light complexity readback',
        bytes: COMPLEXITY_RESULT_BYTES,
        count: READBACKS,
      },
      (mapped) => {
        words.set(new Uint32Array(mapped, 0, COMPLEXITY_RESULT_WORDS))
        // Frozen, the list kept stays until it is a pixel's; the first to be one is kept.
        const list = decodeComplexity(words)
        if (list.written && (!made.freeze || !made.list?.valid)) made.list = list
      },
    ),
    words,
    freeze: false,
    dumpPending: false,
    dumpAsked: false,
    replayed: -1,
    costed: -1,
  }
  states.set(rt, made)
  return made
}

/** Gives the view's resources back. */
export function disposeComplexity(rt: WebgpuPagesRuntime) {
  const state = states.get(rt)
  if (!state) return
  // The image being encoded may still name them: retired, destroyed after its submit.
  const device = rt.gpu.device
  const give = (resource: { destroy(): void } | undefined) =>
    resource && (device ? retire(device, resource) : resource.destroy())
  give(state.result)
  state.ring.destroy()
  give(state.cost?.texture)
  give(state.scene?.texture)
  give(state.heat?.block)
  states.delete(rt)
}

/** Requests the mapping of the list copied this image, once its encoder is submitted. */
export const complexitySubmitted = (rt: object) =>
  states.get(rt as WebgpuPagesRuntime)?.ring.submitted()

/** Whether the view paints the heat map this image: asked, not frozen, a cost above 0 to normalise by, and an input drawn on the screen. */
const paintsHeatmap = (values: SampledLightsSettings, target: number) =>
  complexityDrawn(target) &&
  values.sampledLightsVisualizeLightComplexityHeatmap &&
  !values.sampledLightsVisualizeLightComplexityFreeze &&
  values.sampledLightsVisualizeLightComplexityMaxCost > 0

/**
 * What the view asks of the sampling's image of `input` (`surface` or `front`, the nearest translucent layer's): the pixel to replay and where its list goes, unless the list is frozen and
 * held, and where the cost of every pixel goes where the heat map is painted. None when the view shows another input.
 */
export function complexityRequest(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  values: SampledLightsSettings,
  input: 'surface' | 'front',
): ComplexityRequest | undefined {
  const target = complexityTargetOf(values, rt.run.diagnostic)
  if (target !== (input === 'front' ? COMPLEXITY.frontLayer : COMPLEXITY.opaque)) {
    const held = states.get(rt)
    if (held) {
      held.cost = releaseSized(device, held.cost)
      held.scene = releaseSized(device, held.scene)
    }
    return undefined
  }
  const state = stateOf(rt, device)
  state.freeze = values.sampledLightsVisualizeLightComplexityFreeze
  const size = rt.gpu.targetSize
  const result = state.freeze && state.list?.valid ? undefined : state.result
  const cost = paintsHeatmap(values, target)
    ? (state.cost = sizedTexture(device, state.cost, size, {
        label: 'Trillion3D light complexity cost',
        format: COMPLEXITY_COST_FORMAT,
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
      }))?.view
    : (state.cost = releaseSized(device, state.cost))
  const frame = rt.run.frame
  const encoded = (part: 'replay' | 'cost') => {
    if (part === 'replay') state.replayed = frame
    else state.costed = frame
  }
  return result || cost ? { cursor: debugCursor(rt, size), result, cost, encoded } : undefined
}

/** The colour of a light's line and symbol: orange selected, else its own colour dimmed when not seen, or green. */
function lightColor(light: ComplexityLight, selected: boolean, own: boolean) {
  if (selected) return DEBUG_COLORS.orange
  const mix = (low: number, high: number) => low + (high - low) * light.seen
  if (!own)
    return debugColor(
      mix(NOT_SEEN[0], SEEN[0]),
      mix(NOT_SEEN[1], SEEN[1]),
      mix(NOT_SEEN[2], SEEN[2]),
    )
  const peak = Math.max(...light.color, 1e-8)
  const [r, g, b] = light.color.map((c) => c / peak) as [number, number, number]
  return debugColor(mix(r * 0.5, r), mix(g * 0.5, g), mix(b * 0.5, b))
}

/** The line and symbol of one light from the point `from`. */
function drawLight(
  lines: DebugLines,
  from: readonly [number, number, number],
  light: ComplexityLight,
  axes: ReturnType<typeof cameraAxes>,
  color: number,
) {
  const { place } = light
  if (light.kind === COMPLEXITY_KIND.directional) {
    lines.world(
      from,
      [
        from[0] + place[0] * DIRECTION_LENGTH,
        from[1] + place[1] * DIRECTION_LENGTH,
        from[2] + place[2] * DIRECTION_LENGTH,
      ],
      color,
    )
    return
  }
  lines.world(from, place, color)
  if (light.kind === COMPLEXITY_KIND.spot) spotSymbol(lines, place, LIGHT_SYMBOL_SIZE, axes, color)
  else if (light.kind === COMPLEXITY_KIND.rect)
    rectSymbol(lines, place, LIGHT_SYMBOL_SIZE, axes, color)
  else sphereSymbol(lines, place, LIGHT_SYMBOL_SIZE, color)
}

/** The ray of the camera through the point `at` of the surface: the eye and the direction, or, orthographic, a point behind the surface and the view direction. */
function cameraRay(cam: EngineCamera, at: readonly [number, number, number]) {
  const vp = cam.viewPoint
  const toward = [vp[0]! - at[0] * vp[3]!, vp[1]! - at[1] * vp[3]!, vp[2]! - at[2] * vp[3]!]
  const length = hypot3(toward[0]!, toward[1]!, toward[2]!) || 1
  const direction = [-toward[0]! / length, -toward[1]! / length, -toward[2]! / length]
  const origin =
    vp[3]! > 0.5
      ? [vp[0]!, vp[1]!, vp[2]!]
      : [at[0] - direction[0]! * 1e4, at[1] - direction[1]! * 1e4, at[2] - direction[2]! * 1e4]
  return { origin, direction }
}

/** Writes the list as text and as lines in the sampled lighting's debug text, the dump to the console when asked. */
function drawList(
  rt: WebgpuPagesRuntime,
  state: ComplexityState,
  lines: DebugLines,
  cam: EngineCamera,
  values: SampledLightsSettings,
) {
  const list = state.list ?? {
    written: false,
    valid: false,
    position: [0, 0, 0],
    sum: 0,
    lights: [],
  }
  const ids = rt.lights.store.ids
  const names = (rank: number) => ids[rank] ?? `Light ${rank}`
  const display = rt.gpu.displaySize
  const cursor = debugCursor(rt, rt.gpu.targetSize)
  const shown = Math.min(list.lights.length, values.sampledLightsVisualizeLightComplexityMaxLights)
  const [x, y] = listOrigin(display)
  const rows = headerRows(cursor, list.lights.length, state.freeze)
  rows.forEach((text, row) =>
    lines.text(text, x, y + row * TEXT_LINE, row === 2 ? DEBUG_COLORS.silver : DEBUG_COLORS.white),
  )
  const scale = [display[0] / rt.gpu.targetSize[0], display[1] / rt.gpu.targetSize[1]] as const
  const ray = cameraRay(cam, list.position)
  const selected = list.valid
    ? selectedLight(
        list,
        shown,
        names,
        display,
        [(cursor[0] + 0.5) * scale[0], (cursor[1] + 0.5) * scale[1]],
        ray.origin,
        ray.direction,
      )
    : -1
  const axes = cameraAxes(cam)
  for (let index = 0; index < shown; index++) {
    const light = list.lights[index]!
    const color = lightColor(
      light,
      index === selected,
      values.sampledLightsVisualizeLightComplexityLightColor,
    )
    if (list.valid) drawLight(lines, list.position, light, axes, color)
    lines.text(
      `${rowPrefix(light, list.sum)}${names(light.rank)}`,
      x,
      y + (rows.length + index) * TEXT_LINE,
      index === selected ? DEBUG_COLORS.orange : DEBUG_COLORS.white,
    )
  }
  // The dump goes out once each time the option turns on, when a list has landed.
  if (!values.sampledLightsVisualizeLightComplexityDump) state.dumpAsked = false
  else if (!state.dumpAsked) {
    state.dumpAsked = true
    state.dumpPending = true
  }
  if (state.dumpPending && state.list?.valid) {
    state.dumpPending = false
    console.log(dumpText(state.list, names))
  }
}

/** The heat map's pipeline, on a layout of its own (the cost texture holds 32-bit floats, which are not filtered), and its block. */
function heatmapPass(device: GPUDevice) {
  const layout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 2, visibility: FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
    ],
  })
  return {
    pipeline: screenPassPipeline(
      device,
      'Trillion3D light complexity heat map',
      wgslModule(HEATMAP_WGSL),
      HEATMAP_ENTRY,
      device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    ),
    block: device.createBuffer({
      label: 'Trillion3D light complexity heat map block',
      size: HEATMAP_BLOCK_WORDS * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    }),
  }
}

/** Paints the heat map over the display image: the image copied apart, then each pixel written as its grey times the colour of its cost. */
function drawHeatmap(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  state: ComplexityState,
  values: SampledLightsSettings,
) {
  const { gpu } = rt
  const cost = state.cost
  const target = gpu.displayView
  if (!cost) state.scene = releaseSized(device, state.scene)
  if (!cost || !target || !gpu.displayTexture || state.costed !== rt.run.frame) return
  const scene = (state.scene = sizedTexture(device, state.scene, gpu.displaySize, {
    label: 'Trillion3D light complexity scene',
    format: DISPLAY_FORMAT,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  }))
  if (!scene) return
  const heat = (state.heat ??= heatmapPass(device))
  const pipeline = heat.pipeline.get()
  if (!pipeline) return
  device.queue.writeBuffer(
    heat.block,
    0,
    new Float32Array([
      cost.size[0] / gpu.displaySize[0],
      cost.size[1] / gpu.displaySize[1],
      values.sampledLightsVisualizeLightComplexityMaxCost,
      0,
    ]),
  )
  encoder.copyTextureToTexture({ texture: gpu.displayTexture }, { texture: scene.texture }, [
    gpu.displaySize[0],
    gpu.displaySize[1],
  ])
  drawScreenPass(encoder, 'Trillion3D light complexity heat map', pipeline, target, [
    screenPassGroup(device, pipeline, [{ buffer: heat.block }, scene.view, cost.view]),
  ])
}

/** Draws the view over the display image of `rt`: the heat map, then the list in `lines`; and copies the list the replay left to be read back. */
export function drawComplexity(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  lines: DebugLines,
  cam: EngineCamera,
  values: SampledLightsSettings,
  target: number,
) {
  if (!complexityDrawn(target)) {
    lines.text(NOT_DRAWN, ...listOrigin(rt.gpu.displaySize), DEBUG_COLORS.orange)
    return disposeComplexity(rt)
  }
  const state = stateOf(rt, device)
  drawHeatmap(rt, device, encoder, state, values)
  drawList(rt, state, lines, cam, values)
  if (state.replayed !== rt.run.frame) return
  const staging = state.ring.take()
  if (staging) encoder.copyBufferToBuffer(state.result, 0, staging, 0, COMPLEXITY_RESULT_BYTES)
}
