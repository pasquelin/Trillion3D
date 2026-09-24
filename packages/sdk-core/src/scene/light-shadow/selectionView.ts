import { frustumPlanesFromMatrix } from '../../math/frustum/frustum.ts';
import { multiplyMatrix4 } from '../../math/matrix/matrix4.ts';
import { maxStretch } from '../../math/projectionOracles.ts';
import { faceProjection, faceView } from './math.ts';

/**
 * What a cluster cut needs to select the casters of a shadow region FROM THE LIGHT: the six
 * planes that bound the region, the view its error is measured in, and the scale that turns a
 * world error into shadow-map texels. `planes` and `view` are those of the render frame, whose
 * origin the caller names — the frame the cut's world matrices are expressed in.
 */
export interface FaceSelection {
  planes: Float32Array;
  view: Float32Array;
  /** The same view in the world frame, and the region's clip matrix — the face projection
   *  cropped to the widened region: what a camera-shaped cut reads (`EngineCamera`). */
  worldView: Float64Array;
  clip: Float64Array;
  /** Texels per unit of view-space length at unit depth: the face's own resolution. */
  focal: number;
  /** The same scale in clip units, the projection's first term: `focal / (side / 2)`. */
  clipScale: number;
  /** Clip-w weight of the face's projection: 1 for a lamp face, 0 for a sun level. */
  perspective: number;
  near: number;
  stretch: number;
  /** Three matrices of working space, owned so that writing a selection allocates nothing. */
  scratch: Float64Array;
}

/**
 * Selection view of region `rect` of the face `writeFace` has just composed, `side` texels
 * wide. The region is widened by one texel on each side: its planes are rounded to single
 * precision, and a caster that grazes the region must never fall on the wrong side of one.
 *
 * The error scale is the face's: `focal` is half the side times the projection's first term,
 * which is `1 / tan(halfFov)` for a lamp and `1 / halfExtent` for a sun level — texels per
 * unit, at unit depth for the first and everywhere for the second. A cluster's error is then
 * counted in the texels the map it casts into actually has, never in the camera's pixels.
 */
export function writeFaceSelection(
  out: FaceSelection,
  rect: ArrayLike<number>,
  side: number,
  near: number,
  renderOrigin: ArrayLike<number>,
) {
  const { scratch } = out,
    crop = scratch.subarray(0, 16),
    origin = scratch.subarray(16, 32),
    rendered = scratch.subarray(32, 48);
  const texel = 2 / Math.max(1, side);
  const u0 = rect[0] - texel,
    u1 = rect[1] + texel,
    v0 = rect[2] - texel,
    v1 = rect[3] + texel;
  // Maps the widened rectangle onto the whole clip square: the planes of the product are the
  // region's, by the same extraction the camera's frustum uses.
  crop.fill(0);
  crop[0] = 2 / (u1 - u0);
  crop[5] = 2 / (v1 - v0);
  crop[10] = 1;
  crop[12] = -(u0 + u1) / (u1 - u0);
  crop[13] = -(v0 + v1) / (v1 - v0);
  crop[15] = 1;
  origin.fill(0);
  origin[0] = origin[5] = origin[10] = origin[15] = 1;
  origin[12] = renderOrigin[0];
  origin[13] = renderOrigin[1];
  origin[14] = renderOrigin[2];
  multiplyMatrix4(out.clip, crop, faceProjection);
  out.worldView.set(faceView);
  multiplyMatrix4(rendered, faceView, origin);
  // The crop is spent once the clip matrix holds it: its storage takes the product.
  multiplyMatrix4(crop, out.clip, rendered);
  frustumPlanesFromMatrix(out.planes, crop);
  out.view.set(rendered);
  out.clipScale = faceProjection[0];
  out.focal = (out.clipScale * side) / 2;
  out.perspective = faceProjection[11] === -1 ? 1 : 0;
  out.near = out.perspective ? near : 0;
  out.stretch = maxStretch(out.view);
  return out;
}

export function createFaceSelection(): FaceSelection {
  return {
    planes: new Float32Array(24),
    view: new Float32Array(16),
    worldView: new Float64Array(16),
    clip: new Float64Array(16),
    focal: 1,
    clipScale: 1,
    perspective: 0,
    near: 0,
    stretch: 1,
    scratch: new Float64Array(48),
  };
}
