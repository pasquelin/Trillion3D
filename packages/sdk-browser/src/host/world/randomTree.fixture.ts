// Random host trees for the equivalence tests of a move (#915): reproducible from a seed, every
// node named from a small pool so that names repeat, and poses drawn from hostile values.
import * as G from '../graph/graph.fixture.ts';
import { random } from '../../page/cut/cutRuleChecks.fixture.ts';
import { HOSTILE_FLOATS } from '../../../../../tests/kit/assert/hostile.ts';
import type { ClusterRoot, PageRec } from '../../page/selection/types.ts';
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';

export type Draw = () => number;

/** A reproducible draw in [0, 1). */
export const seeded = (seed: number): Draw => random(seed);

/** One element of `list`, drawn. */
export const pick = <T>(draw: Draw, list: readonly T[]) => list[Math.floor(draw() * list.length)];

/** Finite values a pose may take, `-0` included, and the hostile ones on top when asked. */
const FINITE = [0, -0, 1, -1, 2.5, -3.75, 0.1, 1e-7, 4096.5];
const ROTATIONS = [
  [0, 0, 0, 1],
  [0, 1, 0, 0],
  [Math.SQRT1_2, 0, 0, Math.SQRT1_2],
  [0.5, 0.5, 0.5, 0.5],
  [0.1, -0.7, 0.2, 0.68],
];

/**
 * A random local pose on `node`. `hostile` adds NaN, the infinities, the smallest subnormal and
 * a null scale; either way one pose in four is a matrix the host sets itself, sheared.
 */
export function drawPose(draw: Draw, node: Object3D, hostile = false) {
  const values = hostile ? [...FINITE, ...HOSTILE_FLOATS] : FINITE;
  const scales = hostile ? [1, -1, 2, 0.5, 0, -0, NaN] : [1, -1, 2, 0.5, 1.25];
  if (draw() < 0.25) {
    const m = Array.from({ length: 16 }, () => pick(draw, values));
    [m[3], m[7], m[11], m[15]] = [0, 0, 0, 1];
    if (!hostile) [m[0], m[5], m[10]] = [2 + draw(), 2 + draw(), 2 + draw()];
    node.matrix.fromArray(m);
    node.matrixAutoUpdate = false;
    return;
  }
  node.matrixAutoUpdate = true;
  node.position.set(pick(draw, values), pick(draw, values), pick(draw, values));
  const [x, y, z, w] = pick(draw, ROTATIONS);
  node.quaternion.set(x, y, z, w);
  node.scale.set(pick(draw, scales), pick(draw, scales), pick(draw, scales));
}

/**
 * A tree of `count` nodes under `source`, each a mesh or a group hung under a node drawn before it,
 * named from `names` names so that some repeat. `source` itself hangs under two ancestors: the
 * index covers the chain above its root too.
 */
export function randomTree(draw: Draw, count: number, names = 6, hostile = false) {
  const top = new G.Group(),
    middle = new G.Group(),
    source = new G.Group();
  top.add(middle);
  middle.add(source);
  source.name = 'source';
  const nodes: Object3D[] = [source];
  for (let i = 0; i < count; i++) {
    const node = draw() < 0.6 ? G.mesh() : new G.Group();
    node.name = `n${Math.floor(draw() * names)}`;
    drawPose(draw, node, hostile);
    pick(draw, nodes).add(node);
    nodes.push(node);
  }
  return { top, source, nodes };
}

/** The roots whose mesh climbs to `node`, in rank order: how a move found them before #915. */
export function climbUnder(roots: readonly ClusterRoot<PageRec>[], node: Object3D) {
  return roots.flatMap((root, i) => {
    for (
      let walk = root.pages[0]?.sourceMesh as Object3D | null | undefined;
      walk;
      walk = walk.parent
    )
      if (walk === node) return [i];
    return [];
  });
}
