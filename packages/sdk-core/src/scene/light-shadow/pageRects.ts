import { LIGHT_KIND, POINT_FACES, type SceneLight } from '../light/contracts.ts';
import { writeFace } from './faces.ts';
import { sunBoxRect } from './math.ts';
import type { SunLevels } from './sunLevels.ts';
import { FULL_FACE } from './volume.ts';
import { LAMP_MIPS, SUN_LEVELS, SUN_WINDOW, lampFacesOf, lampPagesAt } from './virtual.ts';
import { sunPageMetres } from './virtual.ts';

/** Light views of one light: a sun's clipmap levels, a lamp face at each mip. */
const VIEWS = Math.max(SUN_LEVELS, POINT_FACES * LAMP_MIPS);

/**
 * THE PAGES A WORLD BOX COVERS in each view of a shadow light — a sun's clipmap level, a lamp
 * face at a mip —, as one rectangle of pages per view: what a moved box stales (`invalidate.ts`).
 * A page meets the box's projected rectangle edges included, so a box grazing a page stales it.
 * Everything is allocated once, by the plan.
 */
export function createPageRects() {
  /** The pages a box covers in each view, `x0, x1, y0, y1` inclusive: absolute pages of a sun
   *  level, pages of a lamp face's mip. Empty when `x0 > x1` or `y0 > y1`. */
  const rects = new Float64Array(VIEWS * 4);
  /** Face matrices of the lamp being invalidated, its faces and their near plane (one range, one
   *  plane); a box's corners in clip space; its light-plane or face rectangle. */
  const matrices = new Float32Array(POINT_FACES * 16),
    clip = new Float64Array(8 * 3),
    plane = new Float64Array(4);
  let faces = 0,
    near = 0;

  /** Writes view `view`'s rectangle: the pages of `[x0, x0 + n) × [y0, y0 + n)` meeting `plane`
   *  carried to pages, `(plane + offset) · scale`, edges included. Returns the pages covered. */
  function setRect(view: number, scale: number, offset: number, x0: number, y0: number, n: number) {
    const r = view * 4;
    rects[r] = Math.max(x0, Math.ceil((plane[0] + offset) * scale) - 1);
    rects[r + 1] = Math.min(x0 + n - 1, Math.floor((plane[1] + offset) * scale));
    rects[r + 2] = Math.max(y0, Math.ceil((plane[2] + offset) * scale) - 1);
    rects[r + 3] = Math.min(y0 + n - 1, Math.floor((plane[3] + offset) * scale));
    const columns = rects[r + 1] - rects[r] + 1,
      rows = rects[r + 3] - rects[r + 2] + 1;
    return columns > 0 && rows > 0 ? columns * rows : 0;
  }

  /** The pages of every clipmap level the box covers, within the level's extent: a page meets the
   *  box's light-plane rectangle, edges included. Returns the pages covered. */
  function sunRects(sun: SunLevels, slice: number, min: ArrayLike<number>, max: ArrayLike<number>) {
    sunBoxRect(sun.frame, slice * 9, min, max, plane, 0);
    // A bound that is no number — `NaN`, or `0 · ∞` on an axis the frame does not lean on — bounds
    // nothing on that side: the box covers the extent's edge there, never none.
    for (let side = 0; side < 4; side++)
      if (Number.isNaN(plane[side])) plane[side] = side & 1 ? Infinity : -Infinity;
    let covered = 0;
    for (let view = 0; view < SUN_LEVELS; view++) {
      const level = sun.finest[slice] + view;
      const ox = sun.originOf(slice, level, 0),
        oy = sun.originOf(slice, level, 1);
      covered += setRect(view, 1 / sunPageMetres(level), 0, ox, oy, SUN_WINDOW);
    }
    return covered;
  }

  /**
   * The pages of every mip of `face` the box covers, clipped to the face's near plane — where
   * alone a caster writes: its corners in front, and the points where its twelve edges cross the
   * plane. The projection of the clipped box is bounded by those points, so a box half behind the
   * light covers only what lies in front, and a box wholly behind covers nothing.
   */
  function faceRects(face: number, min: ArrayLike<number>, max: ArrayLike<number>) {
    const b = face * 16,
      m = matrices;
    let bounded = true;
    for (let corner = 0; corner < 8; corner++) {
      const x = corner & 1 ? max[0] : min[0],
        y = corner & 2 ? max[1] : min[1],
        z = corner & 4 ? max[2] : min[2],
        c = corner * 3;
      clip[c] = m[b] * x + m[b + 4] * y + m[b + 8] * z + m[b + 12];
      clip[c + 1] = m[b + 1] * x + m[b + 5] * y + m[b + 9] * z + m[b + 13];
      clip[c + 2] = m[b + 3] * x + m[b + 7] * y + m[b + 11] * z + m[b + 15];
      bounded &&= Number.isFinite(clip[c] + clip[c + 1] + clip[c + 2]);
    }
    // A box that bounds nothing finite projects nowhere: it covers the whole face, never none.
    if (bounded) clipToNear();
    else plane.set(FULL_FACE);
    let covered = 0;
    for (let mip = 0; mip < LAMP_MIPS; mip++) {
      // Page `(x, y)` spans `u ∈ [2x/n − 1, 2(x+1)/n − 1]`; rows grow downward, as `plane` holds −v.
      const n = lampPagesAt(mip);
      covered += setRect(face * LAMP_MIPS + mip, n / 2, 1, 0, 0, n);
    }
    return covered;
  }

  /** The face rectangle of the clip-space box: its corners in front of the near plane, and the
   *  points where its edges cross it. */
  function clipToNear() {
    plane[0] = plane[2] = Infinity;
    plane[1] = plane[3] = -Infinity;
    for (let corner = 0; corner < 8; corner++) {
      const c = corner * 3,
        w = clip[c + 2];
      if (w >= near) include(clip[c] / w, clip[c + 1] / w);
      // The three edges from this corner to the ones one axis higher.
      for (let bit = 1; bit < 8; bit <<= 1) {
        if (corner & bit) continue;
        const o = (corner | bit) * 3,
          t = (near - w) / (clip[o + 2] - w);
        if (!(t > 0 && t < 1)) continue;
        include(
          (clip[c] + t * (clip[o] - clip[c])) / near,
          (clip[c + 1] + t * (clip[o + 1] - clip[c + 1])) / near,
        );
      }
    }
  }

  /** Grows the face rectangle to hold normalised point `(u, v)`, rows down: it holds `−v`. */
  function include(u: number, v: number) {
    plane[0] = Math.min(plane[0], u);
    plane[1] = Math.max(plane[1], u);
    plane[2] = Math.min(plane[2], -v);
    plane[3] = Math.max(plane[3], -v);
  }

  /** Composes the lamp's face matrices: every box of the frame is projected by them. */
  function lampFaces(light: SceneLight) {
    faces = lampFacesOf(LIGHT_KIND[light.kind]);
    for (let face = 0; face < faces; face++)
      near = writeFace(matrices, face * 16, null, 0, light, face).near;
  }

  /** The pages of every face and mip of the lamp `lampFaces` composed that the box covers. */
  function lampRects(min: ArrayLike<number>, max: ArrayLike<number>) {
    let covered = 0;
    for (let face = 0; face < faces; face++) covered += faceRects(face, min, max);
    return covered;
  }

  return { rects, sunRects, lampFaces, lampRects };
}
