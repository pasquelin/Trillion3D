import type { PageOps } from './pageOps.ts';

/**
 * THE PAGE VIEW MODEL (#1275): how a page's projection and cull volume are composed, one entry at
 * a time, over `PageOps` — evaluated on numbers by the host's page writers (`writeLampPage`,
 * `shadowOrthographic`, `writeConeVolume`, `writeBoxVolume`, `writeSunSquare`), printed as WGSL by
 * the pass that composes the pages the GPU draws itself (`freshWgsl.ts`). One source: the two
 * cannot aim a page, or bound its casters, differently.
 *
 * A projection is a crop of what it projects: every clip coordinate is `scale · x + offset · w`
 * (`shadowCropped`) — a lamp page's of its face's clip, a sun page's of its view, by the
 * orthography's scales (`shadowOrtho*`).
 */
export function pageViewModel<V>(o: PageOps<V>) {
  const half = o.float(0.5);
  return {
    /** Clip coordinate `x` of homogeneous weight `w`, cropped by `scale` and `offset`. */
    shadowCropped: (x: V, w: V, scale: V, offset: V) => o.add(o.mul(scale, x), o.mul(offset, w)),
    /** An orthography's scale across a square of half-side `half`, centred. */
    shadowOrthoScale: (h: V) => o.div(o.float(2), o.sub(h, o.neg(h))),
    /** Its depth scale and offset over `[0, far]`, reversed: the eye at 1, the far side at 0. */
    shadowOrthoDepthScale: (far: V) => o.div(o.float(1), o.sub(far, o.float(0))),
    shadowOrthoDepthOffset: (far: V) => o.div(far, o.sub(far, o.float(0))),
    /** A world axis of the ray through `(x, y)` of a face of tangent half-field `t`, before its
     *  length is taken: its forward `f`, right `r` and up `u` on that axis. */
    shadowConeRay: (f: V, r: V, u: V, t: V, x: V, y: V) =>
      o.add(f, o.mul(t, o.add(o.mul(x, r), o.mul(y, u)))),
    /** A cone's half-angle from the longest chord between its axis and a corner ray, both unit —
     *  exact in f32 where an arccosine near 1 is not —; all of space past a quarter-turn field. */
    shadowConeHalfAngle: (chord: V, halfFov: V) =>
      o.pick(
        o.ge(halfFov, o.float(Math.PI / 2)),
        o.float(Math.PI),
        o.mul(o.float(2), o.asin(o.min(o.mul(chord, half), o.float(1)))),
      ),
    /** An axis of a sun square's eye: `x` along right `r`, `y` along up `u`, `zNear` along `f`. */
    shadowSunEye: (r: V, u: V, f: V, x: V, y: V, zNear: V) =>
      o.add(o.add(o.mul(r, x), o.mul(u, y)), o.mul(f, zNear)),
    /** `p` moved by `s` along `d`, on one axis. */
    shadowAlong: (p: V, d: V, s: V) => o.add(p, o.mul(d, s)),
    /** The middle and the half-extent of `[low, high]` in normalised coordinates, over `half`. */
    shadowBoxMid: (low: V, high: V, h: V) => o.mul(o.div(o.add(low, high), o.float(2)), h),
    shadowBoxHalf: (low: V, high: V, h: V) => o.mul(o.div(o.sub(high, low), o.float(2)), h),
  };
}
