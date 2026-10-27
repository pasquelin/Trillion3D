import {
  lightFunctionAtlasShape,
  readLightFunctionSetting as read,
  type LightFunctionField,
} from '../../../../sdk-core/src/contracts/lightFunctionOptions.ts'
import { lightFunctionMaterialOf } from '../../../../sdk-core/src/world/material/lightFunctionMaterial.ts'
import type { Material } from '../../../../sdk-core/src/world/material/material.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import { createLightFunctionAtlas, type LightFunctionAtlas } from './atlas.ts'
import type { AtlasFormat } from './renderWgsl.ts'
import { mapsOf } from './maps.ts'
import { graphSlotOf } from './graphSlot.ts'
import {
  lightsWearing,
  planLightFunctions,
  type AtlasShape,
  type LightFunctionPlan,
  type WearingLight,
} from './plan.ts'

/** The consumers of the atlas, by the setting that turns each on: the opaque lighting, the volumetric
 *  fog, the bounce's lights, the translucent layers. */
const CONSUMERS = [
  'lightFunctionDeferred',
  'lightFunctionFog',
  'lightFunctionBounce',
  'lightFunctionTranslucent',
] as const satisfies readonly LightFunctionField[]
export type LightFunctionConsumer = (typeof CONSUMERS)[number]

/** What the frame keeps of the light functions: the atlas, the plan its image used and the numbers
 *  that plan was made from, and what the consumers bind. */
export interface LightFunctionFrame {
  readonly atlas: LightFunctionAtlas
  plan?: LightFunctionPlan
  /** The store's epoch the plan was made at, and the settings it was made with. */
  epoch: number
  settings: string
  /** Whether the plan reads the eye (a limit left a light out): made again at each image. */
  limited: boolean
  /** Whether the atlas is made and its light indices are in the light buffer. */
  active: boolean
}

type Rt = WebgpuPagesRuntime

/** Whether a directional light wears a light function: the volumetric fog reads it for its sun
 *  whatever the setting of its local lights. */
function sunWearsOne(rt: Rt) {
  for (const { light } of wearing(rt)) if (light.kind === 'directional') return true
  return false
}

/** Whether the atlas is wanted this image: the system on, the view drawing light functions, a light
 *  wearing one, and a consumer asking. */
function lightFunctionsWanted(rt: Rt) {
  return (
    rt.lights.store.lightFunctionCount > 0 &&
    read(rt, 'lightFunctionAtlas') &&
    rt.views.active.overrides.lightFunctions &&
    (CONSUMERS.some((consumer) => read(rt, consumer)) || sunWearsOne(rt))
  )
}

/** The format of the atlas, which is also that of the shadow masks of the surface cache's lighting: the setting
 *  `lightFunctionFormat`, whether or not the atlas is made. */
export const lightFunctionFormatOf = (rt: Rt): AtlasFormat =>
  read(rt, 'lightFunctionFormat') === 'colour' ? 'colour' : 'grey'

/** The texels a side of a slot of the atlas: the detail a map of a light function is read at. */
export const lightFunctionSlotSize = (rt: Rt, device: GPUDevice) => shapeOf(rt, device).slot

/** The atlas's shape and format from the settings, the device's largest texture bounding the side. */
function shapeOf(rt: Rt, device: GPUDevice): AtlasShape {
  return lightFunctionAtlasShape(
    {
      lightFunctionAtlasSize: read(rt, 'lightFunctionAtlasSize'),
      lightFunctionSlotResolution: read(rt, 'lightFunctionSlotResolution'),
    },
    device.limits.maxTextureDimension2D,
  )
}

const frameOf = (rt: Rt, device: GPUDevice) =>
  (rt.lights.lightFunction ??= {
    atlas: createLightFunctionAtlas(device, rt.run.graphClocks),
    epoch: -1,
    settings: '',
    limited: false,
    active: false,
  })

/** A light that wears a light function, with the material it wears: the surface cache's pass evaluates apart from the atlas those
 *  the atlas holds no slot of (`standaloneLightFunctions`). */
export type StandaloneLight = WearingLight

/** The lights that wear a light function, in slot order, with their materials (`lightsWearing`). */
const wearing = (rt: Rt) => lightsWearing(rt.lights.store, lightFunctionMaterialOf)

/** The version of each material whose graph's refusal was named, so that it is named once. */
const named = new WeakMap<object, number>()

/** Names a graph the atlas could not compile, once per version of its material: its slot is drawn
 *  from the material's parameters, as a material with no graph is. */
function nameRefusal(rt: Rt, material: Material) {
  const slot = graphSlotOf(material)
  if (!slot || !('error' in slot) || named.get(material) === material.version) return
  named.set(material, material.version)
  rt.diag.engineDiagnostic('light-function-graph-refused', 'A light function graph was refused', {
    reason: slot.error,
  })
}

/** At the frame's entry: starts the compile of the program of every material a light wears, so that
 *  the frames wait for it and none draws a slot before its program is there. */
export function askLightFunctionPrograms(rt: Rt, device: GPUDevice) {
  if (!lightFunctionsWanted(rt)) return
  const frame = frameOf(rt, device),
    shape = shapeOf(rt, device),
    format = lightFunctionFormatOf(rt)
  for (const { material } of wearing(rt)) {
    nameRefusal(rt, material)
    frame.atlas.ask(material, shape, format)
  }
}

/** Whether a map of a material a light wears is not yet read at the detail its slot shows: such an
 *  image is drawn again, never held. */
export function lightFunctionsWaiting(rt: Rt) {
  return (
    (!!rt.lights.lightFunction?.active && rt.lights.lightFunction.atlas.waiting) ||
    standalonePending.has(rt)
  )
}

/** The runtimes whose last image left a light function apart from the atlas unevaluated (its program compiling, a map not yet in
 *  the colour atlas) or its maps not read at full detail: such an image is drawn again, never held. */
const standalonePending = new WeakSet<object>()

/** Records whether the surface cache's lighting left a light function apart from the atlas waiting this image. */
export function markStandalonePending(rt: Rt, pending: boolean) {
  if (pending) standalonePending.add(rt)
  else standalonePending.delete(rt)
}

/** The lights apart from the atlas last found, by the store's epoch and the plan they were found under: the same list until either moves. */
const standaloneHeld = new WeakMap<
  object,
  { epoch: number; plan: LightFunctionPlan | undefined; lights: StandaloneLight[] }
>()

/**
 * The lights whose light function the surface cache evaluates apart from the atlas: those that wear one while the view draws
 * light functions, less those the atlas holds a slot of AND the cache reads (`lightFunctionBounce`). A light is without a slot
 * where the atlas is not made (off, no consumer, no light function drawn), where the cache is not among the atlas's readers, or
 * where a limit left the light out (`planLightFunctions`).
 */
export function standaloneLightFunctions(rt: Rt): StandaloneLight[] {
  const { store } = rt.lights
  if (store.lightFunctionCount === 0 || !rt.views.active.overrides.lightFunctions) return []
  const plan = lightFunctionResources(rt, 'lightFunctionBounce')
    ? rt.lights.lightFunction?.plan
    : undefined
  const held = standaloneHeld.get(rt)
  if (held && held.epoch === store.epoch && held.plan === plan) return held.lights
  const lights = [...wearing(rt)].filter(({ slot }) => !(plan && plan.entryOf[slot] > 0))
  standaloneHeld.set(rt, { epoch: store.epoch, plan, lights })
  return lights
}

/** Gives every light no light function: the atlas is not made. */
function clearIndices(rt: Rt) {
  const { store } = rt.lights
  for (let slot = 0; slot < store.count; slot++) store.assignLightFunction(slot, 0)
}

/**
 * The light functions of an image, before the light buffer goes up: the plan of which light reads
 * which entry of the table (`planLightFunctions`), the indices written into the lights' kind words,
 * and the atlas drawn. Nothing is done, and every light is given none, while the atlas is not wanted.
 */
export function encodeLightFunctions(
  rt: Rt,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
) {
  const frame = rt.lights.lightFunction
  if (!lightFunctionsWanted(rt)) {
    if (frame?.active) {
      clearIndices(rt)
      frame.active = false
      frame.epoch = -1
    }
    return
  }
  const live = frameOf(rt, device),
    { store } = rt.lights,
    shape = shapeOf(rt, device),
    format = lightFunctionFormatOf(rt),
    maxLights = read(rt, 'lightFunctionMaxLights'),
    settings = `${shape.edge}|${shape.slot}|${maxLights}|${read(rt, 'lightFunctionFog')}`
  if (!live.plan || live.limited || live.epoch !== store.epoch || live.settings !== settings) {
    const plan = planLightFunctions(
      store,
      shape,
      maxLights,
      cam.eye,
      read(rt, 'lightFunctionFog'),
      lightFunctionMaterialOf,
    )
    for (let slot = 0; slot < store.count; slot++)
      store.assignLightFunction(slot, plan.entryOf[slot])
    live.plan = plan
    live.settings = settings
    // The assignment moved the epoch itself: the plan is held as of it.
    live.epoch = store.epoch
    live.limited = plan.skipped > 0
  }
  live.atlas.encode(encoder, live.plan, shape, format, mapsOf(rt))
  live.active = true
}

/** How the atlas stands for a consumer: −1 where it reads none, else the atlas's count of changes
 *  (`LightFunctionAtlas.changes`) — what caches the light a consumer gets through it (the bounce's probes) is traced
 *  again when it moves. */
export const lightFunctionRevision = (rt: Rt, consumer: LightFunctionConsumer) =>
  lightFunctionResources(rt, consumer) ? rt.lights.lightFunction!.atlas.changes : -1

/** What a consumer binds to read the light functions, or none when it is not one that asks or the
 *  atlas is not made: the atlas, whose table is under its slots (`layout.ts`). */
export function lightFunctionResources(rt: Rt, consumer: LightFunctionConsumer) {
  const frame = rt.lights.lightFunction
  // The fog's sun reads the atlas whatever its local lights' setting: the shader tells them apart.
  const asked = consumer === 'lightFunctionFog' || read(rt, consumer)
  return frame?.active && asked ? frame.atlas.view : undefined
}
