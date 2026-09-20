/**
 * How many numbers one element occupies in a flat batch buffer. Declared once, here, because a
 * stride written twice is a stride that will one day disagree with itself: `mathBatch.ts` and the
 * kernels beside it all read these.
 */
export const MATRIX_VALUES = 16;
export const POSITION_VALUES = 3;
export const QUATERNION_VALUES = 4;
/** A bounding sphere: centre then radius. */
export const SPHERE_VALUES = 4;
/** A 3×3 normal matrix. */
export const NORMAL_MATRIX_VALUES = 9;
