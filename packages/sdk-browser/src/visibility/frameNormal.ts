import type { VisMaterial } from './types.ts';

/** The second normal factor of `mat` in the frame a pass shades in: one read from vertex
 *  tangents takes the factor written for them, one rebuilt from the triangle — every page's —
 *  the factor turned for it (`../host/surfaceImport.ts`). */
export const frameNormalScaleY = (mat: VisMaterial, vertexTangents: boolean) =>
  vertexTangents ? (mat.tangentNormalScaleY ?? mat.normalScaleY) : mat.normalScaleY;
