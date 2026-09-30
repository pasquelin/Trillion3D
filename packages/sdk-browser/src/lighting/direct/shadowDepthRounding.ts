/** A map's depth is float32 in [0, 1]: its epsilon, 2⁻²³, rounds the stored depth and again the
 *  reference, so a margin under their sum is lost — at a fine texel of a wide map, half a texel
 *  is under it. The floor is the format's, in the map's own depth: never a length of the scene. */
export const SHADOW_DEPTH_ROUNDING = 2 * 2 ** -23;
