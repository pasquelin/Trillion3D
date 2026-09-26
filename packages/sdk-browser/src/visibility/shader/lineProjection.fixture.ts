/**
 * The two projections the line tests run the real shader texts under: the engine's (reversed
 * depth, infinite far: `z = near`, `w = distance`) and a forward one (`z = −w` at the near plane)
 * as the WebGL2 path draws, on a view-space vector, with the image they are seen in.
 */
export const LINE_VIEWPORT = [800, 600];
const NEAR = 0.1,
  FOCAL = 1 / Math.tan(Math.PI / 6);
type Clip = number[];
export const LINE_PROJECTIONS = {
  wgsl: (x: number, y: number, z: number, w: number): Clip => [
    (FOCAL * x * LINE_VIEWPORT[1]) / LINE_VIEWPORT[0],
    FOCAL * y,
    NEAR * w,
    -z,
  ],
  glsl: (x: number, y: number, z: number, w: number): Clip => [
    (FOCAL * x * LINE_VIEWPORT[1]) / LINE_VIEWPORT[0],
    FOCAL * y,
    -1.002 * z - 0.2002 * w,
    -z,
  ],
};
/** A clip position in the image's pixels, from its centre. */
export const toPixels = (c: Clip) => [0, 1].map((i) => (c[i] / c[3]) * 0.5 * LINE_VIEWPORT[i]);
