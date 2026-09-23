// Live hierarchy scenario (batch M3a): a scene that moves frame after frame, with everything the
// reference update rule makes delicate — partial poses, hand-set local matrices with or without
// automatic update, reparenting and detach (a detached subtree keeps stale matrices), removals
// and additions, `updateWorldMatrix` on any node, `lookAt`, reads and frames in the middle. Each
// frame ends with a root update and a snapshot of every live node: stale matrices must be stale
// on both sides, identically.
import { alea, cameraAuHasard, dans, pose, sousArbre, tire } from './hierarchieScenarios.ts';
import type { HierarchyOp, Vec3 } from './hierarchieScenarios.ts';

const HAUTS: Vec3[] = [
  [0, 1, 0],
  [0, 0, 1],
  [1, 0, 0],
  [0, -1, 0],
];

/** A hand-set local matrix: a roughly composed pose, sometimes sheared. */
const matriceAuHasard = (): number[] =>
  Array.from({ length: 16 }, (_, i) => (i === 15 ? 1 : dans(4)));

/**
 * `taille` nodes under root 0 (never removed nor moved), `images` frames of one to eight actions,
 * a hostile pose once every `rareteHostile` on average.
 */
export function liveScenario(size: number, images: number, rareteHostile: number): HierarchyOp[] {
  const ops: HierarchyOp[] = [],
    parents: number[] = [],
    liveNodes: boolean[] = [],
    cameras = new Set<number>();
  let prochain = 0;
  const ajoute = (parent: number) => {
    const id = prochain++;
    const camera = alea() < 0.08 ? cameraAuHasard() : null;
    const [p, q, s] = pose(rareteHostile);
    ops.push(['ajoute', id, parent, p, q, s, camera]);
    parents[id] = parent;
    liveNodes[id] = true;
    if (camera) cameras.add(id);
    return id;
  };
  const liveNode = (horsRacine: boolean): number => {
    if (horsRacine && !liveNodes.some((v, id) => v && id)) ajoute(0);
    for (;;) {
      const id = Math.floor(alea() * prochain);
      if (liveNodes[id] && !(horsRacine && id === 0)) return id;
    }
  };
  ajoute(-1);
  for (let n = 1; n < size; n++) ajoute(liveNode(false));
  ops.push(['maj', 0, true]);
  for (let image = 0; image < images; image++) {
    const actions = 1 + Math.floor(alea() * 8);
    for (let a = 0; a < actions; a++) {
      const r = alea();
      if (r < 0.3) {
        const [p, q, s] = pose(rareteHostile);
        ops.push([
          'pose',
          liveNode(false),
          alea() < 0.8 ? p : null,
          alea() < 0.6 ? q : null,
          alea() < 0.5 ? s : null,
        ]);
      } else if (r < 0.38) ops.push(['local', liveNode(false), matriceAuHasard()]);
      else if (r < 0.45) ops.push(['auto', liveNode(false), alea() < 0.6]);
      else if (r < 0.52) {
        const id = liveNode(true);
        let parent = alea() < 0.15 ? -1 : liveNode(false);
        if (parent >= 0 && sousArbre(parents, liveNodes, id).includes(parent)) parent = -1;
        ops.push(['rattache', id, parent]);
        parents[id] = parent;
      } else if (r < 0.56) {
        const id = liveNode(true),
          retires = sousArbre(parents, liveNodes, id);
        ops.push(['retire', id, retires]);
        for (const n of retires) {
          liveNodes[n] = false;
          cameras.delete(n);
        }
      } else if (r < 0.62) ajoute(liveNode(false));
      else if (r < 0.72) ops.push(['majMonde', liveNode(false), alea() < 0.5, alea() < 0.5]);
      else if (r < 0.8)
        ops.push(['vise', liveNode(false), [dans(60), dans(60), dans(60)], tire(HAUTS)]);
      else if (r < 0.88) ops.push(['lis', liveNode(false)]);
      else if (r < 0.94 && cameras.size) ops.push(['image', tire([...cameras]), alea() < 0.5]);
      else ops.push(['maj', liveNode(false), alea() < 0.3]);
    }
    ops.push(['maj', 0, alea() < 0.2], ['instantane', 0]);
  }
  return ops;
}

const M1 = [0.8, 0.1, -0.5, 0, -0.2, 1.5, 0.3, 0, 0.4, -0.6, 0.9, 0, 3, -7, 2, 1],
  M2 = [-1, 0, 0, 0, 0, 2, 0.5, 0, 0, -0.25, 1, 0, -4, 1, 9, 1];
const racine = (id: number, parent = -1): HierarchyOp => [
  'ajoute',
  id,
  parent,
  [1, -2, 3],
  [0.1, 0.7, -0.1, 0.7],
  [2, 1, -1],
  null,
];

/**
 * The reference marking rules, played on purpose rather than left to chance: the
 * `matrixWorldNeedsUpdate` flag set by `updateWorldMatrix` then cleared by `updateMatrixWorld`,
 * a stale world matrix under a parent without automatic update then caught up by `force`, a
 * detached subtree, reparenting under a higher-index node, removal then reuse of indices.
 */
export function marquages(): HierarchyOp[] {
  return [
    racine(0),
    racine(1, 0),
    racine(2, 1),
    ['maj', 0, true],
    ['majMonde', 2, false, false],
    ['auto', 2, false],
    ['maj', 0, false],
    ['auto', 1, false],
    ['local', 1, M1],
    ['majMonde', 1, false, false],
    ['maj', 2, false],
    ['instantane', 0],
    racine(3),
    racine(4, 3),
    ['maj', 3, true],
    ['majMonde', 4, false, false],
    ['auto', 4, false],
    ['auto', 3, false],
    ['local', 3, M2],
    ['majMonde', 3, false, false],
    ['maj', 4, false],
    ['instantane', 0],
    ['local', 4, M1],
    ['maj', 3, false],
    ['instantane', 0],
    ['maj', 3, true],
    ['instantane', 0],
    ['rattache', 4, -1],
    ['pose', 3, [5, 5, 5], null, null],
    ['auto', 3, true],
    ['maj', 3, false],
    ['maj', 4, false],
    ['instantane', 0],
    ['auto', 4, true],
    ['maj', 4, false],
    ['instantane', 0],
    racine(5),
    racine(6),
    ['rattache', 5, 6],
    ['pose', 6, null, [0, 0, 0.6, 0.8], [1, -3, 1]],
    ['maj', 6, false],
    racine(7, 5),
    ['majMonde', 7, true, false],
    ['lis', 7],
    ['retire', 6, [6, 5, 7]],
    racine(8, 0),
    racine(9, 8),
    ['rattache', 0, 3],
    ['maj', 3, true],
    ['instantane', 0],
  ];
}
