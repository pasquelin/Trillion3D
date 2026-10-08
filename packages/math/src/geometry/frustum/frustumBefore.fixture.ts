// The frustum's point and sphere tests before their six planes were unrolled, word for word but
// their names: the oracles `frustumMoves.test.ts` holds the shipped ones to.

function planeDistance(p: ArrayLike<number>, at: number, x: number, y: number, z: number) {
  return p[at] * x + p[at + 1] * y + p[at + 2] * z + p[at + 3]
}

export function frustumContainsPointBefore(
  planes: ArrayLike<number>,
  x: number,
  y: number,
  z: number,
) {
  for (let i = 0; i < 24; i += 4) if (planeDistance(planes, i, x, y, z) < 0) return false
  return true
}

export function frustumExcludesSphereBefore(
  planes: ArrayLike<number>,
  x: number,
  y: number,
  z: number,
  reach: number,
) {
  for (let i = 0; i < 24; i += 4) if (planeDistance(planes, i, x, y, z) < -reach) return true
  return false
}
