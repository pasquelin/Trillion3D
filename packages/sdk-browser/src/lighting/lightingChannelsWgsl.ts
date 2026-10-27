import { wgslConsts } from '../../../math/src/wgsl/consts.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import {
  ALL_LIGHTING_CHANNELS_MASK,
  DEFAULT_LIGHTING_CHANNELS_MASK,
} from '../../../sdk-core/src/contracts/lightingChannelsAbi.ts'

/** The mask and the stored mask the shaders name, and the one decode of a stored mask (`storedToChannels`): every carrier
 *  (`sdk-core/src/contracts/lightingChannelsAbi.ts`) shifts its word to the stored bits and this turns them to the mask, the default's
 *  bit turned back. */
export const LIGHTING_CHANNELS_WGSL = wgslBlock(
  'LIGHTING_CHANNELS_WGSL',
  [],
  `${wgslConsts({
    LIGHTING_CHANNELS_ALL: ALL_LIGHTING_CHANNELS_MASK,
    LIGHTING_CHANNELS_DEFAULT: DEFAULT_LIGHTING_CHANNELS_MASK,
  })}
fn storedToChannels(stored:u32)->u32{return (stored&LIGHTING_CHANNELS_ALL)^LIGHTING_CHANNELS_DEFAULT;}`,
)
