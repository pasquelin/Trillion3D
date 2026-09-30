import * as G from '../../host/graph/graph.fixture.ts';
import type { MatrixElements } from '../../math/matrixElements.ts';
import type { PageLocations, PlacementIndex, Placements } from './placements.ts';

/** Every index of an empty list reads 0: a page of the single identity root. */
const zeros = () =>
  new Proxy<number[]>([], { get: (_t, p) => (typeof p === 'symbol' ? undefined : 0) });

type Identity = Placements & PageLocations;

/**
 * One root at the identity, and the location of every page: what a test page of the identity root
 * is placed by. It is both a `Placements` — an array of one root — and a `PageLocations` whose
 * `roots` names itself and whose every packed rank maps to that root (#1235), so a test can hand
 * it to either reader.
 */
export const identityRoots = (): Identity => {
  const roots = [{ world: new G.Matrix4() as MatrixElements }] as unknown as Identity;
  Object.assign(roots, {
    packed: zeros(),
    rootOfPacked: zeros() as unknown as Int32Array,
  });
  (roots as { roots: Placements }).roots = roots;
  return roots;
};

/** The placement tables of a list whose `i`-th page is placed by root `i` (#1235). */
function perPagePlacement(roots: Placements): PlacementIndex {
  const n = roots.length;
  return {
    baseOfRoot: Int32Array.from({ length: n }, (_, i) => i),
    rootOfPacked: Int32Array.from({ length: n }, (_, i) => i),
  };
}

/** Locations of `roots`, the `i`-th page placed by root `i`: the fixture every test uses. */
export function locatedBy(roots: Placements): PageLocations {
  return {
    roots,
    packed: Array.from({ length: roots.length }, (_, i) => i),
    rootOfPacked: perPagePlacement(roots).rootOfPacked,
  };
}

/** Locations of `count` pages all placed by the single identity root. */
export const identityLocations = (_count: number): PageLocations => identityRoots();


