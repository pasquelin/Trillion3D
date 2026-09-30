// The deadline of a request ahead (`aheadDue.ts`) in TypeScript, bit for bit the kernel's: what the
// oracle (`oracle/oracle.fixture.ts`) replays.

/** Signed distance to plane `at` of `planes` of the box corner furthest along its normal: negative
 *  outside. A plane with no normal — one no box leaves — reads zero. */
function planeReach(
  planes: ArrayLike<number>,
  at: number,
  min: ArrayLike<number>,
  max: ArrayLike<number>,
) {
  const nx = planes[at],
    ny = planes[at + 1],
    nz = planes[at + 2],
    length = Math.hypot(nx, ny, nz);
  if (!(length > 0)) return 0;
  const x = nx > 0 ? max[0] : min[0],
    y = ny > 0 ? max[1] : min[1],
    z = nz > 0 ? max[2] : min[2];
  return (nx * x + ny * y + nz * z + planes[at + 3]) / length;
}

/** The deadline of the box `min`–`max`: the latest crossing of a camera plane, over the six. A plane
 *  that reads as no number — an infinite far plane — is never crossed late. */
export function aheadDue(
  camera: ArrayLike<number>,
  ahead: ArrayLike<number>,
  min: ArrayLike<number>,
  max: ArrayLike<number>,
) {
  let due = 0;
  for (let at = 0; at < 24; at += 4) {
    const outside = -planeReach(camera, at, min, max);
    if (!(outside > 0)) continue;
    const inside = planeReach(ahead, at, min, max);
    due = Math.max(due, outside / (outside + (inside > 0 ? inside : 0)));
  }
  return due;
}
