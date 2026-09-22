// The turn lives here, in a module with no import: the lighting scene that draws a sphere
// bundles it without the geometry builder and its buffers.
/** The four points where a turn crosses an axis, exactly: cosine and sine of 0, ¼, ½, ¾ turn. */
const AXES: readonly (readonly [number, number])[] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];

/**
 * Cosine and sine at `fraction` of the arc `length` from `start` — a whole turn from 0 unless
 * said: the point a circular primitive places. On a whole turn, a fraction that lands on an axis
 * is exactly there, where the trigonometric functions would leave 6e-17 for the maths' 0.
 */
export function turnPoint(fraction: number, start = 0, length = Math.PI * 2) {
  if (start === 0 && length === Math.PI * 2 && Number.isInteger(4 * fraction))
    return AXES[(((4 * fraction) % 4) + 4) % 4];
  const angle = start + fraction * length;
  return [Math.cos(angle), Math.sin(angle)] as const;
}

/**
 * A latitude–longitude sphere as flat arrays: `longitudeSegments` meridians, `latitudeSegments`
 * parallels, the poles on the `y` axis, texture `u` around and `v` from the south pole up. The
 * lighting experiment scene draws its sphere with it, and `geometry.sphere` wraps it.
 */
export function sphereArrays(
  center: readonly [number, number, number],
  radius: number,
  longitudeSegments = 64,
  latitudeSegments = 32,
) {
  const positions: number[] = [],
    normals: number[] = [],
    uv: number[] = [],
    indices: number[] = [];
  const columns = Math.max(3, Math.floor(longitudeSegments)),
    rows = Math.max(2, Math.floor(latitudeSegments));
  for (let y = 0; y <= rows; y++)
    for (let x = 0; x <= columns; x++) {
      // The polar angle is half a turn over the rows: poles and equator land exactly.
      const [cosTheta, sinTheta] = turnPoint(y / rows / 2),
        [cosPhi, sinPhi] = turnPoint(x / columns);
      const nx = sinTheta * cosPhi,
        ny = cosTheta,
        nz = sinTheta * sinPhi;
      positions.push(center[0] + nx * radius, center[1] + ny * radius, center[2] + nz * radius);
      normals.push(nx, ny, nz);
      uv.push(x / columns, 1 - y / rows);
    }
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < columns; x++) {
      const a = y * (columns + 1) + x,
        b = a + columns + 1,
        c = b + 1,
        d = a + 1;
      if (y < rows - 1) indices.push(a, c, b);
      if (y > 0) indices.push(a, d, c);
    }
  return { positions, normals, uv, indices };
}
