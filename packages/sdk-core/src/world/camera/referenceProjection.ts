import type { Matrix4 } from '../math/matrix4.ts';

/** The optics a projection is composed from: a camera's. */
export interface ProjectionOptics {
  /** `'orthographic'` keeps every size; any other value is a perspective. */
  readonly projection: string;
  /** Field of view top to bottom, in degrees. */ readonly fov: number;
  /** Width over height. */ readonly aspect: number;
  /** Nearest distance drawn. */ readonly near: number;
  /** Farthest distance drawn. */ readonly far: number;
  /** Magnification. */ readonly zoom: number;
  /** Left edge of the orthographic box. */ readonly left: number;
  /** Right edge. */ readonly right: number;
  /** Top edge. */ readonly top: number;
  /** Bottom edge. */ readonly bottom: number;
}

/**
 * Writes into `out` the projection a renderer drawing with `optics` composes, in the reference's
 * depth convention with a finite far plane, number for number. The world composes its own
 * (`engineCamera.ts`): this one is for a draw that keeps the reference's convention.
 */
export function referenceProjection(out: Matrix4, optics: ProjectionOptics) {
  const { near, far, zoom } = optics;
  if (optics.projection === 'orthographic') {
    const dx = (optics.right - optics.left) / (2 * zoom),
      dy = (optics.top - optics.bottom) / (2 * zoom);
    const cx = (optics.right + optics.left) / 2,
      cy = (optics.top + optics.bottom) / 2;
    const left = cx - dx,
      right = cx + dx,
      top = cy + dy,
      bottom = cy - dy;
    const w = 1.0 / (right - left),
      h = 1.0 / (top - bottom),
      p = 1.0 / (far - near);
    // prettier-ignore
    return out.set(
      2 * w, 0, 0, -(right + left) * w,
      0, 2 * h, 0, -(top + bottom) * h,
      0, 0, -2 * p, -(far + near) * p,
      0, 0, 0, 1,
    );
  }
  const top = (near * Math.tan((Math.PI / 180) * 0.5 * optics.fov)) / zoom;
  const height = 2 * top,
    width = optics.aspect * height;
  const left = -0.5 * width;
  const right = left + width,
    bottom = top - height;
  const x = (2 * near) / (right - left),
    y = (2 * near) / (top - bottom);
  const a = (right + left) / (right - left),
    b = (top + bottom) / (top - bottom);
  const c = -(far + near) / (far - near),
    d = (-2 * far * near) / (far - near);
  // prettier-ignore
  return out.set(
    x, 0, a, 0,
    0, y, b, 0,
    0, 0, c, d,
    0, 0, -1, 0,
  );
}
