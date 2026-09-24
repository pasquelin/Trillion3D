import { composeFace, shadowOrthographic } from './math.ts';
import { FULL_FACE, writeBoxVolume } from './volume.ts';
import type { SunLevels } from './sunLevels.ts';
import { sunPageMetres } from './virtual.ts';

const eye: [number, number, number] = [0, 0, 0];
const axis: [number, number, number] = [0, 0, 0];
const boxCenter: [number, number, number] = [0, 0, 0];

/**
 * View-projection of a square of sun pages — `cells` pages of level `level` per side, top-left
 * page `(ax, ay)` —, and the volume the cull opposes to it: an orthography over that square, the
 * eye on the near side of the clipmap's depth range, looking along the propagation direction.
 * One page is what a page draw composes; a run's extent is what its light cut selects in.
 *
 * The page's square in the light plane is `[ax, ax + cells) · S` along `right` and down `up`,
 * the square the shading reads it at (`sunLevels.ts`): the eye stands at its centre, so the
 * projection maps it exactly onto the clip square, and the draw's viewport onto the physical
 * page. Depth runs from the near side (1) to the far side (0) of the range, reversed like the
 * camera's. Returns the planes the orthography published.
 */
export function writeSunSquare(
  matrices: Float32Array,
  matBase: number,
  cull: Float32Array | null,
  cullBase: number,
  sun: SunLevels,
  slice: number,
  level: number,
  ax: number,
  ay: number,
  cells = 1,
) {
  const f = slice * 9,
    { frame, depth } = sun;
  const page = sunPageMetres(level),
    u = (ax + cells / 2) * page,
    v = -(ay + cells / 2) * page,
    zNear = depth[slice * 2],
    far = depth[slice * 2 + 1] - zNear;
  for (let a = 0; a < 3; a++) {
    axis[a] = frame[f + 6 + a];
    eye[a] = frame[f + a] * u + frame[f + 3 + a] * v + axis[a] * zNear;
    boxCenter[a] = eye[a] + axis[a] * (far / 2);
  }
  const planes = shadowOrthographic((cells * page) / 2, far);
  composeFace(matrices, matBase, eye, axis);
  if (cull) writeBoxVolume(cull, cullBase, boxCenter, (cells * page) / 2, far / 2, FULL_FACE);
  return planes;
}
