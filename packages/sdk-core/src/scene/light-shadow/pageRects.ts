import { POINT_FACES, type SceneLight } from '../light/contracts.ts';
import { writeFace } from './faces.ts';
import { sunBoxRect } from './math.ts';
import type { SunLevels } from './sunLevels.ts';
import { LAMP_MIPS, SUN_LEVELS, SUN_WINDOW, lampPagesAt, sunPageMetres } from './virtual.ts';

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
  /** Face matrices of the lamp being invalidated and their depth spans; the box's light-plane or
   *  face rectangle; the box clipped to a point face's depth span. */
  const matrices = new Float32Array(POINT_FACES * 16),
    spans = new Float64Array(POINT_FACES * 2),
    plane = new Float64Array(4),
    low = new Float64Array(3),
    high = new Float64Array(3);

  /** Writes view `view`'s rectangle; returns the pages it covers. */
  function setRect(view: number, x0: number, x1: number, y0: number, y1: number) {
    const r = view * 4;
    rects[r] = x0;
    rects[r + 1] = x1;
    rects[r + 2] = y0;
    rects[r + 3] = y1;
    return x0 > x1 || y0 > y1 ? 0 : (x1 - x0 + 1) * (y1 - y0 + 1);
  }

  /** The pages of every clipmap level the box covers, within the level's extent: a page meets the
   *  box's light-plane rectangle, edges included. Returns the pages covered. */
  function sunRects(sun: SunLevels, slice: number, min: ArrayLike<number>, max: ArrayLike<number>) {
    sunBoxRect(sun.frame, slice * 9, min, max, plane, 0);
    let covered = 0;
    for (let view = 0; view < SUN_LEVELS; view++) {
      const level = sun.finest[slice] + view,
        metres = sunPageMetres(level),
        ox = sun.originOf(slice, level, 0),
        oy = sun.originOf(slice, level, 1);
      covered += setRect(
        view,
        Math.max(ox, Math.ceil(plane[0] / metres) - 1),
        Math.min(ox + SUN_WINDOW - 1, Math.floor(plane[1] / metres)),
        Math.max(oy, Math.ceil(plane[2] / metres) - 1),
        Math.min(oy + SUN_WINDOW - 1, Math.floor(plane[3] / metres)),
      );
    }
    return covered;
  }

  /**
   * The pages of every mip of `face` the box `low..high` covers. A corner at or behind the light's
   * plane leaves the rectangle unbounded: the whole face. A point face never meets one — its box was
   * clipped to its depth span —, a spot may.
   */
  function faceRects(face: number) {
    const b = face * 16,
      m = matrices;
    plane[0] = plane[2] = Infinity;
    plane[1] = plane[3] = -Infinity;
    const empty = low[0] > high[0] || low[1] > high[1] || low[2] > high[2];
    for (let corner = 0; corner < 8 && !empty; corner++) {
      const x = corner & 1 ? high[0] : low[0],
        y = corner & 2 ? high[1] : low[1],
        z = corner & 4 ? high[2] : low[2];
      const w = m[b + 3] * x + m[b + 7] * y + m[b + 11] * z + m[b + 15];
      if (w <= 1e-6) {
        plane[0] = plane[2] = -Infinity;
        plane[1] = plane[3] = Infinity;
        break;
      }
      const u = (m[b] * x + m[b + 4] * y + m[b + 8] * z + m[b + 12]) / w,
        v = (m[b + 1] * x + m[b + 5] * y + m[b + 9] * z + m[b + 13]) / w;
      plane[0] = Math.min(plane[0], u);
      plane[1] = Math.max(plane[1], u);
      plane[2] = Math.min(plane[2], v);
      plane[3] = Math.max(plane[3], v);
    }
    let covered = 0;
    for (let mip = 0; mip < LAMP_MIPS; mip++) {
      // Columns grow with u, rows downward: page `(x, y)` spans `u ∈ [2x/n − 1, 2(x+1)/n − 1]`.
      const n = lampPagesAt(mip),
        half = n / 2;
      covered += setRect(
        face * LAMP_MIPS + mip,
        Math.max(0, Math.ceil((plane[0] + 1) * half) - 1),
        Math.min(n - 1, Math.floor((plane[1] + 1) * half)),
        Math.max(0, Math.ceil((1 - plane[3]) * half) - 1),
        Math.min(n - 1, Math.floor((1 - plane[2]) * half)),
      );
    }
    return covered;
  }

  /** Composes the lamp's face matrices, and each face's depth span `near, far`. */
  function lampFaces(light: SceneLight, faces: number) {
    for (let face = 0; face < faces; face++) {
      const planes = writeFace(matrices, face * 16, null, 0, light, face);
      spans[face * 2] = planes.near;
      spans[face * 2 + 1] = planes.far;
    }
  }

  /** The pages of every face and mip of a lamp the box covers (`lampFaces` composed). A point face
   *  is axis-aligned: the box is clipped to its depth span along the axis, where alone a caster
   *  writes. */
  function lampRects(
    light: SceneLight,
    faces: number,
    min: ArrayLike<number>,
    max: ArrayLike<number>,
  ) {
    let covered = 0;
    for (let face = 0; face < faces; face++) {
      low.set(min);
      high.set(max);
      if (faces === POINT_FACES) {
        const axis = face >> 1,
          at = light.position![axis],
          near = spans[face * 2],
          far = spans[face * 2 + 1];
        low[axis] = Math.max(low[axis], face & 1 ? at - far : at + near);
        high[axis] = Math.min(high[axis], face & 1 ? at - near : at + far);
      }
      covered += faceRects(face);
    }
    return covered;
  }

  return { rects, sunRects, lampFaces, lampRects };
}
