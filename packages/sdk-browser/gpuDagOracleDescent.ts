import { DAG_NODE_FLOATS } from './gpuDagTypes.ts';
import { dagNodeFloor, dagNodeVerdict } from './gpuDagOracleMath.ts';
import { NODE_FIRST_CHILD, NODE_WORLD } from './gpuDagPackNodes.ts';
import type { dagViewFrames } from './gpuDagOracleMath.ts';

/**
 * La descente de l'oracle : le miroir Node de `gpuDagLevelWgsl.ts`.
 *
 * Un nœud rejeté n'engendre rien, et une feuille jamais atteinte reste rejetée. `nodeFlags` porte le
 * verdict de chaque nœud — non nul veut dire « ne descends pas ici » —, et seules les feuilles
 * retenues retombent à zéro : ce sont elles seules que les grappes consultent ensuite.
 *
 * `prunedFloor` est le plus petit plancher que l'élagage par le haut a écarté, par primitive. Au
 * -dessus de lui, l'escalade de résidence réclamerait un sous-arbre que la descente n'a pas ouvert,
 * et le repli épinglé s'arme (`gpuDagFloorWgsl.ts`).
 *
 * Posée à part de `gpuDagOracle.ts` : c'est une étape entière, elle a son miroir WGSL à elle, et
 * l'oracle qui la portait avait atteint sa limite de lignes.
 */
export function dagOracleDescent(
  packed: { nodeCount: number; worldCount: number; nodes: Float32Array; rootNodes: Uint32Array },
  frames: ReturnType<typeof dagViewFrames>,
) {
  const { nodes } = packed,
    nodeInts = new Uint32Array(nodes.buffer);
  const nodeFlags = new Uint8Array(Math.max(1, packed.nodeCount)).fill(1);
  const prunedFloor = new Float64Array(Math.max(1, packed.worldCount)).fill(Infinity);
  const frontier: number[] = [];
  for (let w = 0; w < packed.worldCount; w++)
    if (packed.rootNodes[w] !== 0xffffffff) frontier.push(packed.rootNodes[w]);
  while (frontier.length) {
    const n = frontier.pop() as number;
    const children = dagNodeVerdict(frames, nodes, nodeInts, n);
    if (children < 0) {
      nodeFlags[n] = 2;
      continue;
    }
    const floor = dagNodeFloor(frames, nodes, nodeInts, n);
    if (floor > frames.pixelError) {
      const w = nodeInts[n * DAG_NODE_FLOATS + NODE_WORLD];
      if (floor < prunedFloor[w]) prunedFloor[w] = floor;
      nodeFlags[n] = 2;
      continue;
    }
    if (children) {
      const first = nodeInts[n * DAG_NODE_FLOATS + NODE_FIRST_CHILD];
      for (let c = 0; c < children; c++) frontier.push(first + c);
      continue;
    }
    nodeFlags[n] = 0;
  }
  return { nodeFlags, prunedFloor };
}
