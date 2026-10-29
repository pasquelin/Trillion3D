import type { HostImage } from '../../../../sdk-core/src/contracts/hostImage.ts'
import { readRectLightAtlasSetting } from '../../../../sdk-core/src/contracts/rectLightAtlasOptions.ts'
import {
  NO_RECT_ATLAS_SLOT,
  type RectAtlasSlot,
} from '../../../../sdk-core/src/scene/light/fields.ts'
import {
  sourceTextureOffsetOf,
  sourceTextureScaleOf,
} from '../../../../sdk-core/src/scene/light/lightSourceTexture.ts'
import type { SceneLightStore } from '../../../../sdk-core/src/scene/light/store.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import { postSamplers } from '../../gpu/core/postSamplers.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { createRectLightAtlasManager, type AtlasConfig, type AtlasUpdate } from './manager.ts'
import {
  atlasFormatFor,
  rectAtlasProgramsReady,
  encodeAdd,
  encodeClear,
  encodeCopy,
  encodeFilter,
  makeAtlasTexture,
  noAtlasTexture,
  type AtlasTexture,
} from './gpu.ts'
import { pictureView } from './pictures.ts'

/** What the frame keeps of the rectangle lights' atlas: the slots, the texture, and the slot each textured light holds. */
export interface RectLightAtlasFrame {
  readonly manager: ReturnType<typeof createRectLightAtlasManager>
  gpu: AtlasTexture
  /** The atlas's view, made with its texture: the one object programs' bind groups are keyed by. */
  view: GPUTextureView | undefined
  /** The slot each light that names a picture holds, by light id, with what it holds it for. */
  readonly held: Map<string, { image: HostImage; share: string; slot: number }>
  /** The store's atlas epoch and the pictures' version the slots were last synced at. */
  epoch: number
  imagesVersion: number
}

type Rt = WebgpuPagesRuntime

const frameOf = (rt: Rt): RectLightAtlasFrame =>
  (rt.lights.rectAtlas ??= {
    manager: createRectLightAtlasManager(),
    gpu: noAtlasTexture(),
    view: undefined,
    held: new Map(),
    epoch: -1,
    imagesVersion: -1,
  })

/** The atlas's settings of this image. */
export const rectLightAtlasConfig = (rt: Rt): AtlasConfig => ({
  // No greater than the device's textures.
  maxResolution: Math.min(
    readRectLightAtlasSetting(rt, 'rectLightAtlasMaxResolution'),
    rt.gpu.device?.limits.maxTextureDimension2D ?? Infinity,
  ),
  maxRatio: readRectLightAtlasSetting(rt, 'rectLightAtlasMaxTextureRatio'),
  forceUpdate: readRectLightAtlasSetting(rt, 'rectLightAtlasForceUpdate'),
  resetOnChange: readRectLightAtlasSetting(rt, 'rectLightAtlasResetOnChange'),
  clear: readRectLightAtlasSetting(rt, 'rectLightAtlasClear'),
  debugClear: readRectLightAtlasSetting(rt, 'rectLightAtlasDebugClear'),
  filterQuality: readRectLightAtlasSetting(rt, 'rectLightAtlasFilterQuality'),
  format: readRectLightAtlasSetting(rt, 'rectLightAtlasFormat'),
})

/**
 * Gives each light that names a picture a slot for the picture the host registered under its id, and takes back the slot of a light that went
 * or whose picture or share of it changed. A picture not registered (yet) gives the light no slot: it lights as a plain rectangle.
 */
function syncSlots(
  frame: RectLightAtlasFrame,
  store: SceneLightStore,
  images: { get(id: string): HostImage | undefined } | undefined,
  maxRatio: number,
) {
  const alive = new Set<string>()
  for (let slot = 0; slot < store.count; slot++) {
    const id = store.ids[slot]
    const light = store.light(id)!
    if (light.sourceTexture === undefined) continue
    alive.add(id)
    const image = images?.get(light.sourceTexture)
    const [sx, sy] = sourceTextureScaleOf(light)
    const [ox, oy] = sourceTextureOffsetOf(light)
    const share = `${sx},${sy},${ox},${oy}`
    const had = frame.held.get(id)
    if (had && had.image === image && had.share === share) continue
    if (had) frame.manager.removeTexture(had.slot)
    frame.held.delete(id)
    if (!image) continue
    const slotId = frame.manager.addTexture(image, [sx, sy, ox, oy], maxRatio)
    frame.held.set(id, { image, share, slot: slotId })
  }
  for (const [id, entry] of frame.held)
    if (!alive.has(id)) {
      frame.manager.removeTexture(entry.slot)
      frame.held.delete(id)
    }
}

/** The atlas's texture changed (made or given back): the view programs bind is made again with it. */
function setTexture(frame: RectLightAtlasFrame, device: GPUDevice, next: AtlasTexture) {
  if (frame.gpu.texture && frame.gpu.texture !== next.texture) retire(device, frame.gpu.texture)
  frame.gpu = next
  frame.view = next.texture?.createView()
}

/** What an update asks of the device, encoded: the atlas made or cleared, the slots moved, the pictures drawn and filtered. */
function encodeUpdate(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  frame: RectLightAtlasFrame,
  update: AtlasUpdate,
  config: AtlasConfig,
) {
  if (update.made) {
    const format = atlasFormatFor(device, config.format)
    const next: AtlasTexture = {
      texture: makeAtlasTexture(device, update.made, format),
      size: update.made,
      format,
    }
    if (config.debugClear) encodeClear(device, encoder, next, true)
    if (update.copies && frame.gpu.texture)
      encodeCopy(device, encoder, frame.gpu, next, update.copySlots)
    setTexture(frame, device, next)
  } else if (update.clear) encodeClear(device, encoder, frame.gpu, config.debugClear)
  if (!update.drawn.length) return
  // Slots that show shares of one picture read one texture, made once.
  const views = new Map<unknown, GPUTextureView>()
  encodeAdd(device, encoder, frame.gpu, update.drawn, update.sourceMipBias, (slot) => {
    let view = views.get(slot.source)
    if (!view)
      views.set(slot.source, (view = pictureView(device, encoder, slot.source as HostImage)))
    return view
  })
  encodeFilter(device, encoder, frame.gpu, update.drawn, config)
}

/** The slot of each textured light written into its lanes (`LIGHT_FIELD.rectAtlasOriginX`): where its picture is in the atlas, none while it has no place. */
function assignLanes(frame: RectLightAtlasFrame, store: SceneLightStore) {
  for (let at = 0; at < store.count; at++) {
    const id = store.ids[at]
    if (store.light(id)?.sourceTexture === undefined) continue
    // A light whose picture is not registered holds no slot: its lanes say none.
    const entry = frame.held.get(id)
    const place = entry ? frame.manager.placeOf(entry.slot) : undefined
    const slot: RectAtlasSlot = place?.placed
      ? { x: place.x, y: place.y, width: place.width, height: place.height }
      : NO_RECT_ATLAS_SLOT
    store.assignRectAtlasSlot(at, slot)
  }
}

/**
 * The rectangle lights' atlas of an image, before the light buffer goes up: the slots followed with the lights that name a picture and the
 * pictures the host registered (`world.setRectLightTexture`), the atlas packed, made and drawn where something changed, and each light's
 * lanes given the place of its picture. Nothing is made, and no light is looked at, while the scene has no light that names a picture.
 */
export function encodeRectLightAtlas(rt: Rt, device: GPUDevice, encoder: GPUCommandEncoder) {
  const { store } = rt.lights
  if (store.sourceTextured === 0 && !rt.lights.rectAtlas) return
  const frame = frameOf(rt)
  const config = rectLightAtlasConfig(rt)
  // The pipelines compile off the frame; the frames wait for them, and the lights are plain rectangles meanwhile.
  if (!rectAtlasProgramsReady(device, atlasFormatFor(device, config.format), config.debugClear))
    return
  const images = rt.context.rectLightImages
  const version = images?.version ?? 0
  const synced = frame.epoch !== store.rectAtlasEpoch || frame.imagesVersion !== version
  if (synced) {
    syncSlots(frame, store, images, config.maxRatio)
    frame.epoch = store.rectAtlasEpoch
    frame.imagesVersion = version
  }
  for (const image of images?.takeRefreshed() ?? []) frame.manager.refresh(image)
  const update = frame.manager.update(config)
  if (update) encodeUpdate(device, encoder, frame, update, config)
  if (synced || update) assignLanes(frame, store)
  // No light names a picture any more: the texture goes, and is made again with the next one.
  if (store.sourceTextured === 0) releaseRectLightAtlas(rt)
}

/** The atlas's resources a program that reads the pictures binds, none while no light has a picture in it. */
export function rectAtlasResources(rt: Rt) {
  const frame = rt.lights.rectAtlas
  if (!frame?.view || rt.lights.store.sourceTextured === 0) return undefined
  const { device } = rt.gpu
  return { view: frame.view, sampler: postSamplers(device!).mipped }
}

/** Hands the atlas to the retire list: the session's end, or no light names a picture. */
export function releaseRectLightAtlas(rt: Rt) {
  const frame = rt.lights.rectAtlas
  if (!frame) return
  if (frame.gpu.texture && rt.gpu.device) retire(rt.gpu.device, frame.gpu.texture)
  rt.lights.rectAtlas = undefined
}
