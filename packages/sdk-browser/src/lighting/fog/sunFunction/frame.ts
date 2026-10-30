import { alignUp, ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import { readLightFunctionSetting as read } from '../../../../../sdk-core/src/contracts/lightFunctionOptions.ts'
import { volumetricFogKnobs } from '../../../../../sdk-core/src/contracts/volumetricFogOptions.ts'
import type { ResolvedVolumetricFog } from '../../../../../sdk-core/src/scene/core/fogVolumetric.ts'
import type { EngineCamera } from '../../../camera/engineCamera.ts'
import { FOG_SUN_LIGHT_FUNCTION_PASS } from '../../../diagnostic/stage/passLabels.ts'
import { fogSettingsOf } from '../../../frame/render/fogSettings.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { computeUniformEntry } from '../../../gpu/core/computeBindings.ts'
import { retire } from '../../../gpu/core/frameRetire.ts'
import { oncePerDevice } from '../../../gpu/core/oncePerDevice.ts'
import { standInTexture } from '../../../gpu/core/standIns.ts'
import {
  fullscreenDescriptor,
  preparedPipeline,
  type PreparedPipeline,
} from '../../deferred/fullscreen.ts'
import {
  lightFunctionDisabledOf,
  lightFunctionFadeOf,
} from '../../../../../sdk-core/src/scene/light/lightFunction.ts'
import {
  lightAxesOf,
  STANDALONE_LIGHT_BYTES,
  writeStandaloneLight,
} from '../../lightFunction/entries.ts'
import { wearing } from '../../lightFunction/frame.ts'
import { mapLayoutEntries } from '../../lightFunction/maps.ts'
import { readyMaterial } from '../../surfaceCache/lighting/standaloneMask.ts'
import {
  STANDALONE_MASK_GIVEN_BINDING,
  standaloneMaskBytes,
  standaloneMaskMapped,
  type StandaloneMaskProgram,
} from '../../surfaceCache/lighting/standaloneMaskWgsl.ts'
import { cellGrid } from '../layout.ts'
import {
  frustumSliceSphere,
  SUN_FOG_VIEW_FLOATS,
  sunFogSide,
  writeSunFogView,
  type SunFogCamera,
  type Vec3,
} from './plan.ts'
import { sunFogRenderWgsl } from './renderWgsl.ts'
import { SUN_FOG_VIEW_BINDING } from './viewWgsl.ts'
import { viewState } from '../../../frame/backend/state/viewState.ts'

/**
 * THE SUN'S LIGHT FUNCTION FOR THE VOLUMETRIC FOG, drawn into a texture of the fog's own where the atlas does not hold it (the setting
 * `lightFunctionFog` off, the atlas not made, a limit that left the sun out): once an image, before the volume is built, when the sun
 * the volume lights wears a light function material and the view draws light functions. The texture is a single grey channel
 * (`SUN_FOG_FORMAT`), its side and the sphere it covers made by `plan.ts`, its texels drawn by the material's own program
 * (`renderWgsl.ts`). The volume's scatter reads it with the view block (`sunFogResources`, `readWgsl.ts`); an image that draws none
 * gives it the stand-in texture and a block that says it is not drawn. A material whose program is compiling or whose maps are not
 * in the colour atlas yet leaves the sun plain for that image, which is then drawn again, as is one whose graph reads the time
 * (`sunFogWaiting`).
 */

/** The format of the texture: one 8-bit channel, filtered. */
const SUN_FOG_FORMAT: GPUTextureFormat = 'r8unorm'

/** The program of a material: its bind group layout and its pipeline, compiled off the frame. */
interface Program {
  readonly layout: GPUBindGroupLayout
  readonly pipeline: PreparedPipeline<GPURenderPipeline>
}

/** What a view keeps of the sun's light function for the fog: each view reads its own, as its own sun and camera draw it. */
interface SunFog {
  readonly device: GPUDevice
  /** The view block (`SunFogView`), read by the pass that draws the texture and by the volume. */
  readonly viewBuffer: GPUBuffer
  readonly programs: Map<string, Program>
  texture?: GPUTexture
  view?: GPUTextureView
  side: number
  /** The sun's block and its material's, and the bytes it holds. */
  given?: GPUBuffer
  givenBytes: number
  /** What the last draw was made of, kept to draw again only when the image brings something else: the bytes of the sun's block and its
   *  material's, the view block, and the pipeline. The arrays the next image makes (`next`) take turns with the held ones, so none is made new for an image. */
  held?: {
    data: Uint8Array<ArrayBuffer>
    view: Float32Array<ArrayBuffer>
    pipeline: GPURenderPipeline
  }
  next: { data: Uint8Array<ArrayBuffer>; view: Float32Array<ArrayBuffer> }
  /** The bind group of the last draw and the resources it was made of. */
  group?: GPUBindGroup
  groupOf: unknown[]
  /** The image the texture was last drawn for (`WebgpuRunState.frame`), −1 for none: an image the pass did not run reads the stand-in, never a texture of an earlier one. And whether the last image left the sun plain or animated: such an image is drawn again. */
  drawn: number
  waiting: boolean
}

/** What each view keeps, made at the first image of a view whose sun wears a light function; let go of with the view. */
const states = viewState<SunFog>((state) => {
  release(state)
  retire(state.device, state.viewBuffer)
  if (state.given) retire(state.device, state.given)
})

/** What the volume reads where a view draws none, shared by every view of a device: the stand-in texture and a block of zeros, which says nothing is drawn. */
const nothingDrawn = oncePerDevice((device) => ({
  view: standInTexture(
    device,
    'Trillion3D fog sun light function stand-in',
    SUN_FOG_FORMAT,
  ).createView(),
  block: device.createBuffer({
    label: 'Trillion3D fog sun light function not drawn',
    size: SUN_FOG_VIEW_FLOATS * 4,
    usage: GPUBufferUsage.UNIFORM,
  }),
}))

function stateOf(rt: WebgpuPagesRuntime, device: GPUDevice) {
  let state = states.get(rt.gpu)
  if (!state) {
    state = {
      device,
      viewBuffer: device.createBuffer({
        label: 'Trillion3D fog sun light function view',
        size: SUN_FOG_VIEW_FLOATS * 4,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),
      next: { data: new Uint8Array(0), view: new Float32Array(SUN_FOG_VIEW_FLOATS) },
      programs: new Map(),
      side: 0,
      givenBytes: 0,
      groupOf: [],
      drawn: -1,
      waiting: false,
    }
    states.set(rt.gpu, state)
  }
  return state
}

/** The program of a material over the texture: its layout (the sun's block and the material's, the maps' where it reads any, the view), its pipeline. */
function programOf(state: SunFog, p: StandaloneMaskProgram) {
  const key = p.graph ? `graph|${p.graph.compiled.key}` : `plain|${p.mapped}`
  let program = state.programs.get(key)
  if (!program) {
    const { device } = state
    const label = `Trillion3D fog sun light function ${key}`
    const layout = device.createBindGroupLayout({
      entries: [
        computeUniformEntry(
          STANDALONE_MASK_GIVEN_BINDING,
          { minBindingSize: standaloneMaskBytes(p) },
          GPUShaderStage.FRAGMENT,
        ),
        ...(standaloneMaskMapped(p) ? mapLayoutEntries() : []),
        computeUniformEntry(SUN_FOG_VIEW_BINDING, {}, GPUShaderStage.FRAGMENT),
      ],
    })
    const module = device.createShaderModule({ label, code: sunFogRenderWgsl(p) })
    const targets = [{ format: SUN_FOG_FORMAT }]
    const pipeline = preparedPipeline(
      device,
      fullscreenDescriptor(device, module, layout, 'sunTexel', targets, label),
    )
    state.programs.set(key, (program = { layout, pipeline }))
  }
  return program
}

/** The camera as the bounds read it. */
function cameraOf({ eye, world, projection, perspective }: EngineCamera): SunFogCamera {
  return {
    eye,
    right: [world[0]!, world[1]!, world[2]!],
    up: [world[4]!, world[5]!, world[6]!],
    forward: [-world[8]!, -world[9]!, -world[10]!],
    scaleX: projection[0]!,
    scaleY: projection[5]!,
    // A perspective projection's third column shifts the field, its sign the opposite of an offset of the field; an orthographic one is
    // shifted by its translation, in the sign of the offset.
    offsetX: perspective === 1 ? -projection[8]! : projection[12]!,
    offsetY: perspective === 1 ? -projection[9]! : projection[13]!,
    perspective: perspective === 1,
  }
}

/** The sun the volume lights, where it wears a light function this view draws and the atlas gives the volume none of it. */
function sunWithoutAtlas(rt: WebgpuPagesRuntime) {
  const { store } = rt.lights
  const slot = store.forwardDirectionalSlot
  if (slot < 0 || !rt.views.active.overrides.lightFunctions) return undefined
  const frame = rt.lights.lightFunction
  const inAtlas =
    !!frame?.active && read(rt, 'lightFunctionFog') && (frame.plan?.entryOf[slot] ?? 0) > 0
  if (inAtlas) return undefined
  for (const light of wearing(rt)) if (light.slot === slot) return light
  return undefined
}

/** The cells of the volume along each axis of the view, as the volume's grid cuts it (`cellGrid`). */
function volumeCells(rt: WebgpuPagesRuntime, cell: number, slices: number): Vec3 {
  const [width, height] = rt.gpu.targetSize
  const grid = cellGrid(width, height, cell, slices)
  return [
    Math.min(ceilDiv(width, grid.pixelSize), grid.x),
    Math.min(ceilDiv(height, grid.pixelSize), grid.y),
    grid.z,
  ]
}

/** The texture at `side` texels, made again when the side moved. */
function fitTexture(state: SunFog, side: number) {
  if (state.texture && state.side === side) return state.view!
  if (state.texture) retire(state.device, state.texture)
  state.texture = state.device.createTexture({
    label: 'Trillion3D fog sun light function',
    size: [side, side],
    format: SUN_FOG_FORMAT,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  })
  state.side = side
  return (state.view = state.texture.createView())
}

/** Gives the texture back once nothing draws it. */
function release(state: SunFog) {
  if (state.texture) retire(state.device, state.texture)
  state.texture = state.view = state.group = state.held = undefined
  state.side = 0
}

/** The buffer for a sun's block and its material's of `bytes`, made again when it grows. */
function fitGiven(state: SunFog, bytes: number) {
  if (state.given && state.givenBytes >= bytes) return state.given
  if (state.given) retire(state.device, state.given)
  state.givenBytes = alignUp(bytes, 16)
  state.group = state.held = undefined
  return (state.given = state.device.createBuffer({
    label: 'Trillion3D fog sun light function material',
    size: state.givenBytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  }))
}

/** The bind group of a draw, kept while the resources it is made of are those of the draw before. */
function groupFor(
  state: SunFog,
  layout: GPUBindGroupLayout,
  given: GPUBuffer,
  bytes: number,
  maps: GPUBindGroupEntry[],
) {
  const resources: unknown[] = [layout, given, bytes, ...maps.map(({ resource }) => resource)]
  if (
    state.group &&
    resources.length === state.groupOf.length &&
    resources.every((r, i) => r === state.groupOf[i])
  )
    return state.group
  state.groupOf = resources
  return (state.group = state.device.createBindGroup({
    layout,
    entries: [
      { binding: STANDALONE_MASK_GIVEN_BINDING, resource: { buffer: given, size: bytes } },
      ...maps,
      { binding: SUN_FOG_VIEW_BINDING, resource: { buffer: state.viewBuffer } },
    ],
  }))
}

/**
 * Draws the sun's light function for the volume of this image, where `medium` is the volume it builds: the texture, and the view block
 * the volume reads it by. Nothing is drawn, and the block says so, where there is no volume, the sun wears no light function the view
 * draws, or the atlas holds the sun's for the volume.
 */
export function encodeSunFogFunction(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
  medium: ResolvedVolumetricFog | undefined,
) {
  const sun = medium && sunWithoutAtlas(rt)
  // A view whose sun wears none has no state: the volume reads the shared stand-in and its block of zeros (`sunFogResources`).
  const state = sun ? stateOf(rt, device) : states.get(rt.gpu)
  if (!state) return
  const wasWaiting = state.waiting
  state.drawn = -1
  state.waiting = false
  if (!sun) return release(state)
  const { material, light } = sun
  const camera = cameraOf(cam)
  const axes = lightAxesOf(light)
  const knobs = volumetricFogKnobs(fogSettingsOf(rt).volumetricFogQuality)!
  const side = sunFogSide(
    camera,
    axes.forward,
    volumeCells(rt, knobs.cellSize, knobs.sliceCount),
    read(rt, 'lightFunctionFogSupersample'),
    device.limits.maxTextureDimension2D,
  )
  const ready = readyMaterial(rt, material, (p) => !!programOf(state, p).pipeline.get(), side)
  if (!ready) {
    // An image whose function is not ready draws none (the volume reads the stand-in and a block that says so, as a sun with no function), never a projection of an older camera.
    state.waiting = true
    return
  }
  const { program } = ready
  const { layout, pipeline: prepared } = programOf(state, program)
  const pipeline = prepared.get()!
  const bytes = standaloneMaskBytes(program)
  const given = fitGiven(state, bytes)
  const { next, held } = state
  if (next.data.length !== bytes) next.data = new Uint8Array(bytes)
  next.data.fill(0)
  writeStandaloneLight(next.data.buffer, 0, light, 0)
  next.data.set(new Uint8Array(ready.block), STANDALONE_LIGHT_BYTES)
  const fade = { distance: lightFunctionFadeOf(light), disabled: lightFunctionDisabledOf(light) }
  writeSunFogView(
    next.view,
    frustumSliceSphere(camera, 0, medium.farEnd),
    axes,
    side,
    true,
    cam.eye,
    fade,
  )
  const textureMade = !state.texture || state.side !== side
  const view = fitTexture(state, side)
  // The texture is drawn again only when the sun, its material, the view or the program is not what the last draw was made of.
  const unchanged =
    !textureMade &&
    !wasWaiting &&
    held?.pipeline === pipeline &&
    held.data.length === next.data.length &&
    held.data.every((byte, at) => byte === next.data[at]) &&
    held.view.every((value, at) => value === next.view[at])
  if (!unchanged) {
    device.queue.writeBuffer(given, 0, next.data)
    device.queue.writeBuffer(state.viewBuffer, 0, next.view)
    const pass = encoder.beginRenderPass({
      label: FOG_SUN_LIGHT_FUNCTION_PASS,
      colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: [1, 1, 1, 1] }],
    })
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, groupFor(state, layout, given, bytes, ready.entries))
    pass.draw(3)
    pass.end()
    state.held = { data: next.data, view: next.view, pipeline }
    state.next = {
      data: held?.data ?? new Uint8Array(0),
      view: held?.view ?? new Float32Array(SUN_FOG_VIEW_FLOATS),
    }
  }
  state.drawn = rt.run.frame
  state.waiting = !ready.warm || !!program.graph?.animated
}

/** The texture the volume reads the sun's light function from and its view block: the stand-in and a block that says nothing is drawn, where this image drew none. */
export function sunFogResources(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const state = states.get(rt.gpu)
  if (state?.drawn === rt.run.frame) return { view: state.view!, block: state.viewBuffer }
  const none = nothingDrawn(device)
  return { view: none.view, block: none.block }
}

/** Whether the last image left the sun's light function for the volume plain, its maps not yet read at the detail it shows, or moving with the time: such an image is drawn again, never held. */
export const sunFogWaiting = (rt: WebgpuPagesRuntime) => {
  return !!states.get(rt.gpu)?.waiting
}
