import {
  VOLUMETRIC_FOG_FILTERS,
  type VolumetricFogValues,
} from '../../../../sdk-core/src/contracts/volumetricFogOptions.ts'
import type { ResolvedHeightFog } from '../../../../sdk-core/src/scene/core/fogHeight.ts'
import {
  GLOW_PER_METRE,
  VOLUMETRIC_FOG_DEFAULTS,
} from '../../../../sdk-core/src/scene/core/fogVolumetric.ts'
import { putVec4 as put } from '../../gpu/core/fieldLayout.ts'
import { FOG_VOLUME_FRAME_AT } from './layout.ts'
import { FOG_OBSERVER_REACH, FOG_VIEW_FLOATS, FOG_VIEW_SLOT } from './viewSlots.ts'

/** The sky light as the fog reads it in a view (`FOG_VIEW_SLOT.heightFog`): the strength it mixes
 *  into the fog's colour with, the roughness and the count of mips of the cube it is read at, and
 *  the light's colour. */
export interface SkyLightFogUse {
  strength: number
  roughness: number
  mips: number
  colour: readonly [number, number, number]
}

/** What the view block takes of the camera and the fog beside the frame: whether the projection is a
 *  perspective, the eye's height, and the fog the scene shows, none for a scene that has only air;
 *  whether the view does not show that fog (`hidden`, shown where absent) and the sky light that
 *  lights it (`skyLight`, none where absent). */
export interface FogViewLook {
  perspective: boolean
  eyeHeight: number
  fog: ResolvedHeightFog | undefined
  hidden?: boolean
  skyLight?: SkyLightFogUse
  /** Whether the height fog holds its light out in this view (`FOG_VIEW_SLOT.holdout`). */
  holdout?: boolean
}

/** The filtering of the volume's read, by the number the shader branches on: its place in the list. */
const filterCode = (settings: VolumetricFogValues) =>
  VOLUMETRIC_FOG_FILTERS.indexOf(settings.volumetricFogReadFilter)

/** The bits of an unsigned integer as the float that holds them, for reading the frame's integer word. */
const bits = new Uint32Array(1)
const asFloat = new Float32Array(bits.buffer)

/** `count` words of `frame` from `from` into the slot `slot` of the view block `out`. */
function copyWords(
  out: Float32Array,
  slot: number,
  frame: Float32Array,
  from: number,
  count: number,
) {
  for (let i = 0; i < count; i++) out[slot * 4 + i] = frame[from + i]
}

/** The height fog's lanes (`FOG_VIEW_SLOT.heightFog`, `skyLightColour`): whether the view hides it, and
 *  the sky light that lights it, all zero for none. */
function writeHeightFog(out: Float32Array, look: FogViewLook) {
  const at = FOG_VIEW_SLOT
  const sky = look.skyLight
  put(out, at.heightFog * 4, look.hidden ? 1 : 0, sky?.strength, sky?.roughness, sky?.mips)
  put(out, at.holdout * 4, look.holdout ? 1 : 0)
  if (sky) put(out, at.skyLightColour * 4, sky.colour[0], sky.colour[1], sky.colour[2])
}

/** The fog's switches (`FOG_VIEW_SLOT.options`, `observer`, `match`, `albedo`) as this view and the
 *  settings give them: each lane zero where it is the default. An orthographic view that measures
 *  the fog from its own position holds the observer at its height above the ground, which a view
 *  with no target of its own (the engines' default) takes as the distance it may rise; a fog made
 *  to match the volume takes the volume's glow in their unit, its scatter and its particles. The
 *  height fog's lanes follow (`writeHeightFog`). */
function writeOptions(out: Float32Array, settings: VolumetricFogValues, look: FogViewLook) {
  const at = FOG_VIEW_SLOT
  const ortho = !look.perspective && settings.fogOrthoHeightAdjustment
  put(
    out,
    at.options * 4,
    settings.fogEnabled ? 0 : 1,
    settings.fogReadsAtmosphere ? 0 : 1,
    settings.fogMatchesVolume ? 1 : 0,
    ortho ? 1 : 0,
  )
  if (ortho) out[at.observer * 4] = Math.max(look.eyeHeight, 0) - FOG_OBSERVER_REACH
  writeHeightFog(out, look)
  if (!settings.fogMatchesVolume) return
  const volume = look.fog?.volumetric
  const d = VOLUMETRIC_FOG_DEFAULTS
  const glow = volume ? volume.glow.map((c) => c / GLOW_PER_METRE) : d.glow
  const albedo = volume?.particleColor ?? d.particleColor
  put(out, at.match * 4, glow[0], glow[1], glow[2], volume?.anisotropy ?? d.anisotropy)
  put(out, at.albedo * 4, albedo[0], albedo[1], albedo[2])
}

/**
 * Writes the read side's view block (`FOG_VIEW_SLOT`, `FOG_VIEW_FLOATS` floats): the fog's switches
 * (`writeOptions`) and, from the frame `frame` the volume was built with, `settings` naming the filter
 * and the jitter a surface reads it through: the view-projection, the eye with 1 in its last lane,
 * the forward, the depth's numbers, the span of the cells, their count and the share of them the
 * view uses. Where the volume was not built for the image (`frame` none), all zero but the switches:
 * a surface reads no volume (`fogVolumeBuilt`). The clip plane's slot is left zero: the image that
 * publishes the block writes the view's plane there (`../../frame/render/fogView.ts`). Nothing is
 * allocated.
 */
export function writeFogViewBlock(
  out: Float32Array,
  frame: Float32Array | undefined,
  settings: VolumetricFogValues,
  look: FogViewLook,
) {
  const at = FOG_VOLUME_FRAME_AT
  out.fill(0, 0, FOG_VIEW_FLOATS)
  writeOptions(out, settings, look)
  if (!frame) return out
  copyWords(out, FOG_VIEW_SLOT.projection, frame, at.viewProj, 16)
  copyWords(out, FOG_VIEW_SLOT.eye, frame, at.eye, 3)
  out[FOG_VIEW_SLOT.eye * 4 + 3] = 1
  copyWords(out, FOG_VIEW_SLOT.forward, frame, at.forward, 3)
  out[FOG_VIEW_SLOT.forward * 4 + 3] = filterCode(settings)
  copyWords(out, FOG_VIEW_SLOT.sliceMap, frame, at.sliceMap, 4)
  copyWords(out, FOG_VIEW_SLOT.uv, frame, at.uv, 4)
  copyWords(out, FOG_VIEW_SLOT.grid, frame, at.texture, 4)
  copyWords(out, FOG_VIEW_SLOT.exposure, frame, at.exposure, 4)
  asFloat[0] = frame[at.frame]
  put(
    out,
    FOG_VIEW_SLOT.stretch * 4,
    frame[at.grid] / frame[at.texture],
    frame[at.grid + 1] / frame[at.texture + 1],
    settings.volumetricFogReadJitter,
    bits[0] & 7,
  )
  return out
}
