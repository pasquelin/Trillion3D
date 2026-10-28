import { fieldLayout } from '../../gpu/core/fieldLayout.ts'

/**
 * THE VIEW OF THE SCREEN-SPACE TRACES (`ScreenSpaceView`, one uniform every pass of this folder reads), its fields in one table. All matrices
 * are column matrices, applied to column vectors, and every position is the world's less the eye's `origin` (the view's translated world, whose
 * origin keeps a float's precision); the view space looks down +z. The image and the depth pyramid are the view's whole rectangle, from
 * pixel (0, 0): a screen position `p` in −1..1 (y up) lies at texture coordinate `p · (0.5, −0.5) + 0.5`.
 *  - `worldToClip`, `clipToWorld`: the projection the depth was drawn with, and its inverse (a clip position `(p, deviceZ, 1)` unprojected,
 *    then divided by its w);
 *  - `worldToView`, `viewToWorld`: the view space, +z the depth;
 *  - `clipToPrevClip`: the clip position of a surface point in the last image from its clip position in this one, the camera's motion;
 *    `prevClipToWorld`: the last image's clip position (with its depth) back to this image's translated world;
 *  - `depth`: `(a, b, c, d)` of the projection, `clip.z = a·z + b`, `clip.w = c·z + d` for a view depth `z` (`sceneDepth` inverts it);
 *  - `size`: the pyramid's and image's extent in pixels `xy`, its reciprocal `zw`;
 *  - `camera`: the eye in the translated world `xyz` (zero) and `w` one under a perspective projection, zero under an orthographic one;
 *    `forward`: the view's forward axis `xyz` (the ray of every pixel under an orthographic projection);
 *  - `pixelRadius`: the world radius of a pixel at a depth `z`, `x · z + y` (`pixelRadiusScale`), and the projection's x and y scales `zw`;
 *  - `previous`: the last image's scale and bias, clip position to texture coordinate (`previousScreenScaleBias`);
 *  - `reduced`: the reduced colour's scale and bias of a screen texture coordinate (`reducedColorScaleBias`);
 *  - `reducedLimit`: the last texel of the reduced colour a hit may read `xy`; the pixel's step from the tracing grid to the image `z` and
 *    its offset `w` (`diffuseIndirectHalfRes`: 2 and a half pixel, else 1);
 *  - `frame`: the frame index modulo 8 `x`, the frame's turn of the reflections (`screenReflectionParams`) `y`, the frame number `z`, the
 *    reflections' quality code `w`;
 *  - `reflection`: the reflections' intensity in 0..1 `x`, the roughness mask's scale `y`, the discard `z`, the pre-exposure correction of
 *    the image the rays read `w`;
 *  - `tiles`: the reflection tiles' extent `xy`, whether the rays read the current image, which a hit does not move on (`z`: one, else zero), the tiles' maximum
 *    roughness `w`; `tileSpecular`: the least specular `x`, the image's pre-exposure `w`;
 *  - `temporal`: the reflections' temporal filter: the jitter of the image in pixels `xy`, the correction of the history's pre-exposure `z`, whether the
 *    history is dropped (a camera cut) `w`; `blur`: the width of its kernel `x`, whether the kernel is a Catmull-Rom `y`, the exposure scale of the
 *    luma weight `z`;
 *  - `sky`: the sky's distance in metres `x` (a pixel of the last image farther than this brings no light; 0 turns it off), the pre-exposure
 *    correction of the last image `y`.
 */
export const LAYOUT = fieldLayout('ScreenSpaceView', [
  ['worldToClip', 'mat4x4f'],
  ['clipToWorld', 'mat4x4f'],
  ['worldToView', 'mat4x4f'],
  ['viewToWorld', 'mat4x4f'],
  ['clipToPrevClip', 'mat4x4f'],
  ['prevClipToWorld', 'mat4x4f'],
  ['depth', 'vec4f'],
  ['size', 'vec4f'],
  ['camera', 'vec4f'],
  ['forward', 'vec4f'],
  ['pixelRadius', 'vec4f'],
  ['previous', 'vec4f'],
  ['reduced', 'vec4f'],
  ['reducedLimit', 'vec4f'],
  ['frame', 'vec4u'],
  ['reflection', 'vec4f'],
  ['tiles', 'vec4f'],
  ['tileSpecular', 'vec4f'],
  ['sky', 'vec4f'],
  ['temporal', 'vec4f'],
  ['blur', 'vec4f'],
] as const)
/** Each field's first word in the view. */
export const SCREEN_SPACE_VIEW_AT = LAYOUT.at
