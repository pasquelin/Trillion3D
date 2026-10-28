import type { BounceShape } from '../../../../../sdk-core/src/bounce/contracts.ts'
import type {
  IrradianceFieldSettings,
  ScreenProbeSettings,
} from '../../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import { lightAtlasFormat, type LightAtlasFormat } from '../../../gpu/core/lightAtlasFormat.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import type { WebgpuBounceState } from '../../../frame/backend/state/bounce.ts'
import { indirectSourceOf } from '../screen/cast.ts'
import { waterFrontOf } from '../../../blend/water/waterReflection.ts'
import { createMarkSurface, type MarkSurface } from '../pool/pool.ts'
import {
  encodeHeldProbes,
  idleExpired,
  startHeldProbes,
  type ProbeFrame,
  type ProbeHold,
} from '../probes/hold.ts'
import { screenProbeSettingsOf } from '../screen/settingsOf.ts'
import { encodeFieldOcclusion } from '../screen/frame.ts'
import { writeIndirectWords } from '../screen/indirectWords.ts'
import { createFieldMaps, type FieldMaps } from './maps.ts'
import { createFieldPixels, type FieldPixels } from './pixels.ts'
import { irradianceFieldCacheSettings, irradianceFieldShape } from './shape.ts'

/** What the irradiance field keeps of its own cache of probes between two images (the second radiance cache, as the translucency volume
 *  keeps one); its pool is marked from the image's pixels (`MarkProbesUsedByGBuffer`: the image's depth and view, no screen probes). */
export interface IrradianceFieldHold extends ProbeHold {
  /** The irradiance and occlusion atlases of the probes and the pass that makes them (`createFieldMaps`), made with the probes. */
  maps: FieldMaps | undefined
  /** The pixels' gather (`createFieldPixels`), at the size of the image and the reduction it was made for. */
  pixels: FieldPixels | undefined
  pixelsKey: string | undefined
  /** The screen probes' settings object the shape and settings were made from: made again when it moved. */
  followed: ScreenProbeSettings | undefined
  /** The format the cache's final maps, and the irradiance made from them, are stored in. */
  light: LightAtlasFormat | undefined
}

const newHold = (): IrradianceFieldHold => ({
  probes: undefined,
  maps: undefined,
  pixels: undefined,
  pixelsKey: undefined,
  key: undefined,
  idle: 0,
  followed: undefined,
  shape: undefined,
  shapeKey: undefined,
  light: undefined,
  settings: undefined,
  surface: createMarkSurface(),
})

/** The hold, made where there is none. */
const fieldHold = (bounce: WebgpuBounceState) => (bounce.irradianceField ??= newHold())

/** Whether the image gathers its indirect light by the irradiance field (`finalGatherMethod`) and the screen probes' level lights anything. */
const irradianceFieldWanted = (settings: ScreenProbeSettings) =>
  settings.finalGather === 'irradianceField' && settings.enabled

/** The shape's key: what the levels and the pool are made of, which the probes cannot follow without being made again. */
const keyOf = (shape: BounceShape, field: IrradianceFieldSettings, light: LightAtlasFormat) =>
  [
    shape.cascadeLevels,
    shape.cascadeSize,
    shape.cascadeHalfExtentMetres,
    shape.cascadeBase,
    shape.probePool,
    field.irradianceResolution,
    field.occlusionResolution,
    field.adaptivePlacement,
    light,
  ].join(':')

/** The shape, its key and the settings of the cache for these screen probes' settings, made again only when that object moved. */
function followSettings(
  hold: IrradianceFieldHold,
  screen: ScreenProbeSettings,
  features: { has(name: string): boolean },
) {
  if (hold.settings && hold.followed === screen) return
  hold.followed = screen
  const shape = irradianceFieldShape(screen.irradianceField)
  hold.shape = shape
  hold.light = lightAtlasFormat(screen.cache.light, features)
  hold.shapeKey = keyOf(shape, screen.irradianceField, hold.light)
  hold.settings = irradianceFieldCacheSettings(screen)
}

/** The view's sky light leaking, which the cache's rays cast through the scene's triangles add (`ReflectionSettings.skylightLeakColor`, the reflections' reading of it): written in the cache's own settings. */
function followLeak(rt: WebgpuPagesRuntime, hold: IrradianceFieldHold) {
  const color = rt.gpu.reflection?.settings(rt.context, waterFrontOf(rt)).skylightLeakColor
  const leak = hold.settings!.cache.skylightLeak
  for (let channel = 0; channel < 3; channel++) leak[channel] = color?.[channel] ?? 0
}

/** The probes given back, and any being made forgotten (the making ends with `hold.key` changed). */
function drop(hold: IrradianceFieldHold) {
  hold.probes?.dispose()
  hold.maps?.dispose()
  hold.pixels?.dispose()
  hold.probes = hold.maps = hold.pixels = hold.pixelsKey = hold.key = undefined
}

/** The cache given back, now. */
export function releaseIrradianceField(bounce: WebgpuBounceState) {
  if (bounce.irradianceField) drop(bounce.irradianceField)
}

/** The probes of the shape `key` made, off the frame: the levels first centred on the origin, then following the eye. */
function start(rt: WebgpuPagesRuntime, device: GPUDevice, hold: IrradianceFieldHold, key: string) {
  const maps = createFieldMaps(
    device,
    hold.settings!.irradianceField,
    hold.shape!.probePool,
    hold.light!,
  )
  startHeldProbes(
    rt,
    device,
    hold,
    key,
    {
      surfaceMarks: true,
      afterUpdate: maps.after,
      adaptive: hold.settings!.irradianceField.adaptivePlacement,
    },
    'irradiance-field-unavailable',
    (probes) => {
      hold.probes = probes
      hold.maps = maps
    },
    () => maps.dispose(),
  )
}

/**
 * The probe pass of the irradiance field's cache, beside the world's: its levels follow the eye, the cells the image's pixels mark (`surface`, the pixels' mark of the
 * probes they interpolate) take probes, and the maps of the probes queued are traced after (`flushIrradianceField`), then their irradiance and occlusion are made from them. Made again, off the
 * frame, when the settings changed its shape; given back after `KEEP_IMAGES` images the field was not wanted. A great change of the lighting (`bounce.historyLost`) discards what it holds.
 */
export function encodeIrradianceField(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  frame: ProbeFrame & { surface: MarkSurface | undefined },
) {
  const { bounce, lights } = rt
  const device = rt.gpu.device
  if (!device) return
  const hold = fieldHold(bounce)
  const screen = screenProbeSettingsOf(rt)
  if (!irradianceFieldWanted(screen) || indirectSourceOf(rt) !== 'field') {
    if (idleExpired(hold)) drop(hold)
    return
  }
  hold.idle = 0
  followSettings(hold, screen, device.features)
  followLeak(rt, hold)
  const key = hold.shapeKey!
  if (hold.key !== key) {
    drop(hold)
    if (lights.buffer) start(rt, device, hold, key)
  }
  if (!hold.probes) return
  followSurface(hold.surface, frame.surface)
  encodeHeldProbes(rt, encoder, hold.probes, hold.surface, frame)
}

/** What the pool marks from this image: the image's depth, view and size (the world's surface, `drawnSurface`), none of its screen probes. */
function followSurface(into: MarkSurface, from: MarkSurface | undefined) {
  into.depth = from?.depth
  into.view = from?.view
  into.size[0] = from?.size[0] ?? 0
  into.size[1] = from?.size[1] ?? 0
}

/**
 * THE PIXELS' GATHER, after the field's maps are made (`flushIrradianceField`): the interpolation of the eight probes round each pixel (`createFieldPixels`) at the reduction the settings name,
 * then the one write of the lighting's words (`writeIndirectWords`) from its light. Nothing while the field is not made or the kernels compile: the lighting then takes the sky light's irradiance.
 */
export function encodeFieldPixels(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
) {
  const hold = rt.bounce.irradianceField
  if (!hold?.probes || !hold.maps || !hold.settings || indirectSourceOf(rt) !== 'field') return
  const field = hold.settings.irradianceField
  const { targetSize } = rt.gpu
  const key = `${targetSize[0]}x${targetSize[1]}:${field.interpolateDownsample}`
  if (hold.pixelsKey !== key) {
    hold.pixels?.dispose()
    hold.pixels = createFieldPixels(device, targetSize, field.interpolateDownsample)
    hold.pixelsKey = key
  }
  const pixels = hold.pixels!
  if (!pixels.encode(rt, encoder, hold.probes, hold.maps, field, rt.run.frame)) return
  // The field's short-range occlusion (`irradianceFieldShortRangeAORadius`), which the lighting then applies to the light; none where the pass searches none.
  const occlusion = encodeFieldOcclusion(rt, encoder)
  writeIndirectWords(rt, device, encoder, {
    light: pixels.diffuse,
    rough: pixels.specular,
    open: occlusion?.view ?? pixels.diffuse,
    reduction: pixels.reduction,
    alphaAnswers: true,
    openTexture: !!occlusion,
    openReduction: occlusion?.reduction ?? 0,
    openBent: occlusion?.bent ?? false,
    exposure: 1,
    appliesOcclusion: !!occlusion,
  })
}

/** The maps of the probes the field's cache queued this image traced, in a pass of their own, before the irradiance is made from them. */
export function flushIrradianceField(bounce: WebgpuBounceState, encoder: GPUCommandEncoder) {
  bounce.irradianceField?.probes?.cache.flush(encoder)
}

/** The world's placements moved or arrived: the field's cache holds the light of a scene that was. */
export function restartIrradianceField(bounce: WebgpuBounceState) {
  bounce.irradianceField?.probes?.restart()
}
