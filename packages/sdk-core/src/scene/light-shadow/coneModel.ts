import { hypot3 } from '../../math/primitives/hypot.ts';
import { NUMBERS, type PageOps } from './pageOps.ts';
import { pageViewModel } from './pageViewModel.ts';

/** The vector operations the cone is written over, beside the scalar ones (`PageOps`). */
export interface ConeOps<S, V> {
  plus(a: V, b: V): V;
  minus(a: V, b: V): V;
  scale(a: V, s: S): V;
  /** `a` over its length, or `a` itself when that length is zero. */
  unit(a: V): V;
  length(a: V): S;
  pick(when: S, yes: V, no: V): V;
}

type Vec = readonly number[];
/** On numbers: what the host's page writers compute (`writeConeVolume`), bit for bit as before. */
const VECTORS: ConeOps<number, Vec> = {
  plus: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  minus: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  unit: (a) => {
    let length = 0;
    for (let i = 0; i < 3; i++) length += a[i] * a[i];
    length = Math.sqrt(length) || 1;
    return [a[0] / length, a[1] / length, a[2] / length];
  },
  length: (a) => hypot3(a[0], a[1], a[2]),
  pick: (when, yes, no) => (when ? yes : no),
};

/** Printed as WGSL: vectors are `vec3f`. */
export const VECTORS_WGSL: ConeOps<string, string> = {
  plus: (a, b) => `(${a}+${b})`,
  minus: (a, b) => `(${a}-${b})`,
  scale: (a, s) => `(${a}*${s})`,
  unit: (a) => `normalize(${a})`,
  length: (a) => `length(${a})`,
  pick: (when, yes, no) => `select(${no},${yes},${when})`,
};

/**
 * THE CONE OF A LAMP PAGE (#1275): the light as apex, the ray through the page's centre as axis,
 * the widest of its four corner rays as half-angle — all of space past a quarter-turn field. Its
 * face is forward `f`, right `r` and up `u`, of tangent half-field `t` and half-field `halfFov`;
 * the page is `[u0, u1] × [v0, v1]` of it. Written once over `o` and `v`: the host's
 * `writeConeVolume` evaluates it, the GPU's pages compose by its WGSL (`CONE_MODEL_WGSL`).
 *
 * Exact, never a quality approximation: the projected image of a planar rectangle is spherically
 * convex, so the cap that holds its four corners holds all of it.
 */
export function coneModel<S, V>(o: PageOps<S>, v: ConeOps<S, V>) {
  const view = pageViewModel(o),
    two = o.float(2),
    wide = (halfFov: S) => o.ge(halfFov, o.float(Math.PI / 2));
  /** The unit ray through `(x, y)` of the face. */
  const ray = (f: V, r: V, u: V, t: S, x: S, y: S) =>
    v.unit(v.plus(f, v.scale(v.plus(v.scale(r, x), v.scale(u, y)), t)));
  return {
    shadowConeAxis: (f: V, r: V, u: V, t: S, halfFov: S, u0: S, u1: S, v0: S, v1: S) =>
      v.pick(
        wide(halfFov),
        f,
        ray(f, r, u, t, o.div(o.add(u0, u1), two), o.div(o.add(v0, v1), two)),
      ),
    shadowConeSpread(f: V, r: V, u: V, t: S, halfFov: S, axis: V, u0: S, u1: S, v0: S, v1: S) {
      let chord = o.float(0);
      for (let corner = 0; corner < 4; corner++) {
        const x = corner & 1 ? u1 : u0,
          y = corner & 2 ? v1 : v0;
        chord = o.max(chord, v.length(v.minus(ray(f, r, u, t, x, y), axis)));
      }
      return view.shadowConeHalfAngle(chord, halfFov);
    },
  };
}

/** The cone on numbers: what the host computes. */
export const CONE = /* @__PURE__ */ coneModel(NUMBERS, VECTORS);
