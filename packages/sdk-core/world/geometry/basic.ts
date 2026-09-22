import { GeometryBuilder, fromArrays, normalize } from './builder.ts';
import { sphereArrays, turnPoint } from './sphere.ts';

type V3 = [number, number, number];
const TAU = Math.PI * 2;

/** Where step `s` (a fraction of `segments`) of an edge `size` long and centred on 0 falls,
 *  from the step's integers: the ends are exactly `±size / 2`, the middle exactly 0. */
function along(s: number, segments: number, size: number) {
  const i = Math.round(s * segments);
  if (i === 0) return -size / 2;
  if (i === segments) return size / 2;
  return ((2 * i - segments) * size) / (2 * segments);
}

/** One face of a box or a plane: a sheet spanned by `u` and `v`, pushed `offset` along `n`. */
function sheet(
  b: GeometryBuilder,
  n: V3,
  u: V3,
  v: V3,
  size: [number, number, number],
  segments: [number, number],
) {
  const [uSize, vSize, offset] = size;
  b.grid(segments[0], segments[1], (s, t) => {
    const x = along(s, segments[0], uSize),
      y = along(t, segments[1], vSize);
    return {
      p: [0, 1, 2].map((k) => n[k] * offset + u[k] * x + v[k] * y) as V3,
      n,
      uv: [s, t],
    };
  });
}

/** A box centred on the origin, each face its own sheet so edges stay sharp. */
export function box(width = 1, height = 1, depth = 1, ws = 1, hs = 1, ds = 1) {
  const b = new GeometryBuilder();
  const w = width / 2,
    h = height / 2,
    d = depth / 2;
  sheet(b, [1, 0, 0], [0, 0, -1], [0, 1, 0], [depth, height, w], [ds, hs]);
  sheet(b, [-1, 0, 0], [0, 0, 1], [0, 1, 0], [depth, height, w], [ds, hs]);
  sheet(b, [0, 1, 0], [1, 0, 0], [0, 0, -1], [width, depth, h], [ws, ds]);
  sheet(b, [0, -1, 0], [1, 0, 0], [0, 0, 1], [width, depth, h], [ws, ds]);
  sheet(b, [0, 0, 1], [1, 0, 0], [0, 1, 0], [width, height, d], [ws, hs]);
  sheet(b, [0, 0, -1], [-1, 0, 0], [0, 1, 0], [width, height, d], [ws, hs]);
  return b.build();
}

/** A rectangle in the `xy` plane, facing `+z`. */
export function plane(width = 1, height = 1, ws = 1, hs = 1) {
  const b = new GeometryBuilder();
  sheet(b, [0, 0, 1], [1, 0, 0], [0, 1, 0], [width, height, 0], [ws, hs]);
  return b.build();
}

/** A sphere, `ws` meridians and `hs` parallels, the poles on the `y` axis (`sphereArrays`). */
export function sphere(radius = 1, ws = 32, hs = 16) {
  const arrays = sphereArrays([0, 0, 0], radius, ws, hs);
  return fromArrays(arrays.positions, arrays.normals, arrays.uv, arrays.indices);
}

/** A disc in the `xy` plane, facing `+z`: one fan around the centre. */
export function circle(radius = 1, segments = 32, thetaStart = 0, thetaLength = TAU) {
  const b = new GeometryBuilder();
  const count = Math.max(3, Math.floor(segments));
  const centre = b.vertex([0, 0, 0], [0, 0, 1], [0.5, 0.5]);
  for (let i = 0; i <= count; i++) {
    const [c, s] = turnPoint(i / count, thetaStart, thetaLength);
    b.vertex([radius * c, radius * s, 0], [0, 0, 1], [(c + 1) / 2, (s + 1) / 2]);
    if (i > 0) b.triangle(centre, centre + i, centre + i + 1);
  }
  return b.build();
}

/** A flat annulus in the `xy` plane, facing `+z`. */
export function ring(inner = 0.5, outer = 1, segments = 32, phiSegments = 1) {
  const b = new GeometryBuilder();
  b.grid(Math.max(3, Math.floor(segments)), Math.max(1, Math.floor(phiSegments)), (u, v) => {
    const [c, s] = turnPoint(u),
      r = inner + (outer - inner) * v;
    const x = r * c,
      y = r * s;
    return { p: [x, y, 0], n: [0, 0, 1], uv: [(x / outer + 1) / 2, (y / outer + 1) / 2] };
  });
  return b.build();
}

/** A frustum of cone: `radiusTop` at `+height/2`, `radiusBottom` at `-height/2`, capped unless open. */
export function cylinder(
  radiusTop = 1,
  radiusBottom = 1,
  height = 1,
  radialSegments = 32,
  heightSegments = 1,
  openEnded = false,
) {
  const b = new GeometryBuilder();
  const rs = Math.max(3, Math.floor(radialSegments));
  const slope = (radiusBottom - radiusTop) / height;
  b.grid(rs, Math.max(1, Math.floor(heightSegments)), (u, v) => {
    const [c, s] = turnPoint(u),
      r = radiusTop + (radiusBottom - radiusTop) * v;
    return {
      p: [r * s, height / 2 - v * height, r * c],
      n: normalize(s, slope, c),
      uv: [u, 1 - v],
    };
  });
  if (!openEnded)
    for (const [r, y, ny] of [
      [radiusTop, height / 2, 1],
      [radiusBottom, -height / 2, -1],
    ]) {
      if (r <= 0) continue;
      const centre = b.vertex([0, y, 0], [0, ny, 0], [0.5, 0.5]);
      for (let i = 0; i <= rs; i++) {
        const [c, s] = turnPoint(i / rs);
        b.vertex([r * s, y, r * c], [0, ny, 0], [c * 0.5 + 0.5, s * 0.5 * ny + 0.5]);
        if (i > 0)
          if (ny > 0) b.triangle(centre, centre + i, centre + i + 1);
          else b.triangle(centre, centre + i + 1, centre + i);
      }
    }
  return b.build();
}

/** A cone standing on the `xz` plane's centre, apex at `+height/2`. */
export function cone(
  radius = 1,
  height = 1,
  radialSegments = 32,
  heightSegments = 1,
  open = false,
) {
  return cylinder(0, radius, height, radialSegments, heightSegments, open);
}
