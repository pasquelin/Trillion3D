import { LIGHT_SETTINGS, type ShadowViewpoint } from './sceneLightContracts.ts';
import { faceFrame } from './sceneLightShadowMath.ts';
import { pageRowsOf } from './sceneLightShadowPages.ts';

/**
 * Sphere a cascade covers and the extent its map draws, both in metres. The extent is a
 * whole number of pages on the light plane: `originX` and `originY` are the absolute page
 * column and row (draw frame, `y` down) of its top-left page, `anchor` its depth coordinate
 * along the light axis, snapped to a grid of one sphere diameter, `2r`.
 */
interface SunCascade {
  /** World centre of the extent: page-snapped in the light plane, `anchor` along the axis. */
  center: [number, number, number];
  radius: number;
  /** Side of a page in metres, `2r / (rows − 1)`: the extent is one page wider than the sphere. */
  pageMetres: number;
  /** Half-side of the extent, `rows · page / 2`: the sphere fits in it wherever it snaps. */
  halfSide: number;
  originX: number;
  originY: number;
  anchor: number;
}

/**
 * Camera near plane, at a one-millimetre floor: a view that declares zero, or less,
 * does not open the split on a zero distance. The floor is written only here, and the shadow
 * distance below rereads it rather than keeping its own.
 */
function cameraNearMetres(view: ShadowViewpoint) {
  return Math.max(1e-3, view.near);
}

/**
 * Sun shadow distance: the bound beyond which no cascade tests anything.
 * It is a published fraction of the camera far, held above its near plane so that
 * the split keeps an interval to share even when the view leaves none.
 */
function sunShadowFarMetres(view: ShadowViewpoint) {
  return Math.max(cameraNearMetres(view) * 1.001, view.far * LIGHT_SETTINGS.sunShadowFarFraction);
}

/**
 * Cascade bounds along the camera axis: a geometric sequence, the only one that gives
 * the same relative error everywhere, hence the same texel density from one cascade to the next. The
 * last bound is the shadow distance, a published fraction of the far.
 *
 * The split no longer starts from the camera near plane, which is a ten-thousandth of the far: the
 * geometric sequence took a ratio of fourteen per cascade there, and the first two
 * vanished under a metre; a mix with a uniform sequence caught them up, at the cost of unbalanced
 * seams — twice between the first ones, nearly five times before the last. The floor
 * is now figured from the published ratio: `shadow distance / ratio^cascades`, and the sequence
 * is geometric end to end. A camera whose near plane exceeds this floor keeps its own,
 * and the ratio is only tighter.
 *
 * The first bound, for its part, remains the camera near plane: the floor redistributes the inner
 * bounds, it digs no hole under the observer's nose. The first cascade's
 * sphere is dominated by its far bound, so covering it from the near plane
 * costs it almost no texel.
 */
function sunCascadeSplits(view: ShadowViewpoint, out: Float64Array) {
  const count = LIGHT_SETTINGS.sunCascades;
  const camera = cameraNearMetres(view),
    far = sunShadowFarMetres(view);
  const near = Math.max(camera, far / Math.pow(LIGHT_SETTINGS.sunCascadeRatioMax, count));
  const step = Math.pow(far / near, 1 / count);
  out[0] = camera;
  for (let i = 1; i <= count; i++) out[i] = near * Math.pow(step, i);
}

const splits = new Float64Array(LIGHT_SETTINGS.sunCascades + 1);
/** What `splits` depends on, as it was at the last calculation: the two view distances and the
 *  three split settings. `pretes` distinguishes "never computed" from a kept `NaN`. */
let pretes = false,
  vuNear = 0,
  vuFar = 0,
  vuCount = 0,
  vuFraction = 0,
  vuRatio = 0;

/**
 * Bounds of the current view, recomputed only if the view or the split have changed. They
 * depend on neither the face nor the sun: the four cascades of a frame share them, where
 * each used to redo the four `Math.pow` to recover the same numbers. `Object.is` compares,
 * so `-0` and `NaN` are treated as the calculation would treat them.
 */
function splitsDe(view: ShadowViewpoint) {
  const count = LIGHT_SETTINGS.sunCascades,
    fraction = LIGHT_SETTINGS.sunShadowFarFraction,
    ratio = LIGHT_SETTINGS.sunCascadeRatioMax;
  if (
    pretes &&
    Object.is(vuNear, view.near) &&
    Object.is(vuFar, view.far) &&
    vuCount === count &&
    Object.is(vuFraction, fraction) &&
    Object.is(vuRatio, ratio)
  )
    return splits;
  sunCascadeSplits(view, splits);
  pretes = true;
  vuNear = view.near;
  vuFar = view.far;
  vuCount = count;
  vuFraction = fraction;
  vuRatio = ratio;
  return splits;
}

const sphere = { distance: 0, radius: 0 };
const cascade: SunCascade = {
  center: [0, 0, 0],
  radius: 1,
  pageMetres: 1,
  halfSide: 1,
  originX: 0,
  originY: 0,
  anchor: 0,
};
const right = new Float64Array(3),
  up = new Float64Array(3),
  eye = new Float64Array(3);

/**
 * Sphere circumscribed to the camera frustum between two distances, centred on the view axis. A
 * sphere, not the exact box, because it does not depend on the sun's orientation: the map
 * then keeps the same extent when the camera turns, hence the same texel density and no
 * edge shimmer. This is the named cascade approximation (P5).
 */
function frustumSphere(view: ShadowViewpoint, near: number, far: number) {
  const tanY = Math.tan(view.halfFovY),
    k2 = tanY * tanY * (1 + view.aspect * view.aspect);
  if (k2 * (far + near) >= far - near) {
    sphere.distance = far;
    sphere.radius = far * Math.sqrt(k2);
    return sphere;
  }
  const span = far - near,
    sum = far + near;
  sphere.distance = 0.5 * sum * (1 + k2);
  sphere.radius =
    0.5 * Math.sqrt(span * span + 2 * (far * far + near * near) * k2 + sum * sum * k2 * k2);
  return sphere;
}

/**
 * Cascade `index` of a directional light: its sphere, then the extent its map draws. The
 * extent is aligned on the page grid of the light plane — the `faceFrame` axes the view is
 * composed with —, so a camera step moves it by whole pages and the pages it keeps still
 * describe the same world: only the entering strip is redrawn (virtual shadow map clipmaps).
 * Along the light axis the extent is anchored on a grid of one sphere diameter, `2r`: depth is
 * then the same for every page of the extent, and a move of that size restarts it whole.
 *
 * Snapping moves the centre by up to half a page: the extent is therefore one page wider than
 * the sphere — `rows` pages of `2r / (rows − 1)` — so the sphere is contained wherever it snaps,
 * and no point of the cascade's slab falls outside its map. A one-page face, which cannot slide,
 * takes a grid of `2r` and an extent of `4r` for the same reason.
 *
 * The returned object is reused from one call to the next: the scheduler allocates nothing per frame.
 */
export function sunCascadeOf(
  view: ShadowViewpoint,
  axis: readonly number[],
  index: number,
  side: number,
) {
  const bornes = splitsDe(view);
  const { distance, radius } = frustumSphere(view, bornes[index], bornes[index + 1]);
  const rows = pageRowsOf(side),
    page = rows > 1 ? (2 * radius) / (rows - 1) : 2 * radius,
    halfSide = rows > 1 ? (rows * page) / 2 : 2 * radius;
  faceFrame(axis, right, up);
  for (let a = 0; a < 3; a++) eye[a] = view.position[a] + view.forward[a] * distance;
  let u = 0,
    v = 0,
    w = 0;
  for (let a = 0; a < 3; a++) {
    u += eye[a] * right[a];
    v += eye[a] * up[a];
    w += eye[a] * axis[a];
  }
  // Page rank of the extent centre; the draw frame counts rows downward, hence `-v`.
  const pageX = Math.round(u / page),
    pageY = Math.round(-v / page),
    anchorRank = Math.round(w / (2 * radius));
  cascade.radius = radius;
  cascade.pageMetres = page;
  cascade.halfSide = halfSide;
  cascade.originX = pageX - (rows >> 1);
  cascade.originY = pageY - (rows >> 1);
  cascade.anchor = anchorRank * 2 * radius;
  for (let a = 0; a < 3; a++)
    cascade.center[a] = right[a] * pageX * page - up[a] * pageY * page + axis[a] * cascade.anchor;
  return cascade;
}
