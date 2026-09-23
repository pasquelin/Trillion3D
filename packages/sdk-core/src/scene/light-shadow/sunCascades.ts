import { dotVector3, keepNumbers } from '../../math/primitives/vector.ts';
import { VIEW_NUMBERS, writeView, type ShadowViewpoint } from '../light/contracts.ts';
import { faceFrame } from './math.ts';
import { pageRowsOf } from './pages.ts';
import { frustumSphere, splitsDe } from './sunSplits.ts';

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
 * What the last cascade was computed from: the view's ten numbers, the sun axis, then index
 * and side. The same numbers give the same cascade, and it is not recomputed: the regions of
 * one face, which follow each other, read one calculation instead of one each.
 */
const KEY = VIEW_NUMBERS + 5;
const key = new Float64Array(KEY).fill(NaN),
  next = new Float64Array(KEY);
function writeKey(view: ShadowViewpoint, axis: readonly number[], index: number, side: number) {
  writeView(view, next);
  for (let a = 0; a < 3; a++) next[VIEW_NUMBERS + a] = axis[a];
  next[VIEW_NUMBERS + 3] = index;
  next[VIEW_NUMBERS + 4] = side;
  return next;
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
 * The returned object is reused from one call to the next, and kept as long as the inputs
 * are the same: the scheduler allocates nothing per frame, and consecutive calls for one
 * face cost one calculation.
 */
export function sunCascadeOf(
  view: ShadowViewpoint,
  axis: readonly number[],
  index: number,
  side: number,
) {
  const bornes = splitsDe(view);
  if (keepNumbers(key, writeKey(view, axis, index, side))) return cascade;
  const { distance, radius } = frustumSphere(view, bornes[index], bornes[index + 1]);
  const rows = pageRowsOf(side),
    page = rows > 1 ? (2 * radius) / (rows - 1) : 2 * radius,
    halfSide = rows > 1 ? (rows * page) / 2 : 2 * radius;
  faceFrame(axis, right, up);
  for (let a = 0; a < 3; a++) eye[a] = view.position[a] + view.forward[a] * distance;
  const u = dotVector3(eye, right),
    v = dotVector3(eye, up),
    w = dotVector3(eye, axis);
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
