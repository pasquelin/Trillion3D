/** The capabilities the temporal pass serves: antialiasing, the motion vectors it derives from the
 *  visibility buffer, and the upscaling it reconstructs. Named apart from the pass, so an engine without it (WebGL2) declares
 *  it unsupported without loading any of its code. */
export const TAA_CAPABILITY = 'temporal antialiasing';
const MOTION_CAPABILITY = 'motion vectors';
/** A frame drawn below the display and reconstructed to it (`renderScale`): the pass's own. */
export const UPSCALE_CAPABILITY = 'temporal upscaling';
/** The three, granted and withdrawn together. */
export const TAA_CAPABILITIES = [TAA_CAPABILITY, MOTION_CAPABILITY, UPSCALE_CAPABILITY];
