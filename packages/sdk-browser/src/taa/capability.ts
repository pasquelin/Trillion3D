/** The two capabilities the temporal pass serves: antialiasing, and the motion vectors it derives
 *  from the visibility buffer. Named apart from the pass, so an engine without it (WebGL2) declares
 *  it unsupported without loading any of its code. */
export const TAA_CAPABILITY = 'temporal antialiasing';
export const MOTION_CAPABILITY = 'motion vectors';
