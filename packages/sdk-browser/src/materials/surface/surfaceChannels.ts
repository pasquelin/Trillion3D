import { wgslBlock, wgslFn } from '../../../../math/src/wgsl/decl.ts'
import { LIGHTING_CHANNELS_WGSL } from '../../lighting/lightingChannelsWgsl.ts'
import {
  PLACEMENT_CHANNELS_MASK,
  PLACEMENT_CHANNELS_SHIFT,
} from '../../geometry/dag/info/placementInfoLayout.ts'
import { NO_CONTACT_SHADOW_SURFACE_FLAG } from './surfaceModel.ts'

/**
 * THE LIGHTING CHANNELS OF A SURFACE, per pixel (`../../../../sdk-core/src/contracts/lightingChannelsAbi.ts`):
 * the surface flags' three bits from `LIGHTING_CHANNELS_SURFACE_SHIFT`, the object's channels stored (zero is
 * the default, so a flags word no pass wrote them in says channel 0 alone), set by the opaque resolve from
 * the page's marks (`channelsFlag`) beside the contact shadow's bit, above the specular's byte
 * (`SPECULAR_FLAG_MASK`). The lighting reads them back (`channelsOfFlags`) once a pixel into
 * `surfaceChannels`, which a light's term tests against the light's own; a program that never sets it keeps
 * every channel, and no light is left out of what it lights.
 */
const LIGHTING_CHANNELS_SURFACE_SHIFT = Math.log2(NO_CONTACT_SHADOW_SURFACE_FLAG) + 1

/** The surface flags' bits of a surface whose page marks are `marks`: its lighting channels, in place. */
export const channelsFlag = wgslFn(
  'channelsFlag',
  [],
  `fn channelsFlag(marks:u32)->u32{return (marks&${PLACEMENT_CHANNELS_MASK}u)<<${LIGHTING_CHANNELS_SURFACE_SHIFT - PLACEMENT_CHANNELS_SHIFT}u;}`,
)

/** The mask of the lighting channels a surface of surface-buffer flags `flags` is in. */
export const channelsOfFlags = wgslFn(
  'channelsOfFlags',
  [LIGHTING_CHANNELS_WGSL],
  `fn channelsOfFlags(flags:u32)->u32{return storedToChannels(flags>>${LIGHTING_CHANNELS_SURFACE_SHIFT}u);}`,
)

/** The channels of the pixel (or of the translucent surface) being lit: every channel until a program sets them. */
export const SURFACE_CHANNELS_WGSL = wgslBlock(
  'SURFACE_CHANNELS_WGSL',
  [LIGHTING_CHANNELS_WGSL],
  'var<private> surfaceChannels:u32=LIGHTING_CHANNELS_ALL;',
)
