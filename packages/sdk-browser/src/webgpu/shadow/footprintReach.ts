import { PCF_REACH } from '../../lighting/direct/shadowWgsl.ts';

/** Texels past its footprint a page's casters are culled to: every texel centre a filter reading
 *  inside it weighs lies within `PCF_REACH` of the texel it checks, on either axis. */
export const FOOTPRINT_REACH = Math.ceil(PCF_REACH) + 1;
