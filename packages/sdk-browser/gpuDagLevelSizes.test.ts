// Le majorant sur lequel chaque passe de la descente est lancée à plat. C'est lui qui remplace
// l'armement de l'argument de répartition et la coupure qu'il impose (mesure : `gpuDagHierarchy.ts`),
// et c'est donc lui qui doit être sûr : une file plus longue que son étage laisserait des nœuds retenus
// sans passe pour les lire, et la coupe perdrait de la géométrie sans que rien ne le dise.
import test from 'node:test';
import assert from 'node:assert/strict';
import { flatHierarchy, hierarchyLevelSizes } from './gpuDagHierarchy.ts';
import { DAG_NODE_FLOATS } from './gpuDagTypes.ts';
import { dagFixture } from './pageSelectionDagFixture.ts';
import { packed } from './gpuDagSelectionTestHelpers.ts';

/** L'étage de chaque nœud du DAG rangé, lu comme la descente le lit : les racines à l'étage zéro. */
function etages(dag: ReturnType<typeof packed>['dag']) {
  const ints = new Uint32Array(dag.nodes.buffer);
  const etage = new Int32Array(Math.max(1, dag.nodeCount)).fill(-1);
  let frontier: number[] = [];
  for (const root of dag.rootNodes) if (root !== 0xffffffff) frontier.push(root);
  for (let niveau = 0; frontier.length; niveau++) {
    const suivante: number[] = [];
    for (const node of frontier) {
      assert.equal(etage[node], -1, 'un nœud n’appartient qu’à un étage');
      etage[node] = niveau;
      const base = node * DAG_NODE_FLOATS;
      for (let c = 0; c < ints[base + 15]; c++) suivante.push(ints[base + 3] + c);
    }
    frontier = suivante;
  }
  return etage;
}

test("le compte d'un étage majore la file de sa passe, et la somme couvre tous les nœuds", () => {
  const { dag } = packed(dagFixture());
  const etage = etages(dag);
  const compte = new Int32Array(dag.levelSizes.length);
  let atteints = 0;
  for (const niveau of etage)
    if (niveau >= 0) {
      compte[niveau]++;
      atteints++;
    }
  assert.deepEqual(Array.from(dag.levelSizes), Array.from(compte));
  // Un nœud qu'aucune racine n'atteint n'est jamais lu : la somme des étages est donc ce que la
  // descente peut voir, et rien de plus.
  assert.equal(
    Array.from(dag.levelSizes).reduce((a, b) => a + b, 0),
    atteints,
  );
  assert.ok(atteints > 0);
});

test('les étages de la hiérarchie du rangement se comptent racine comprise', () => {
  // Trente-trois pages : deux feuilles de trente-deux et une, puis leur nœud. Deux étages.
  const pages = Array.from({ length: 33 }, (_, i) => ({ min: [i, 0, 0], max: [i + 1, 1, 1] }));
  const { nodes, stride } = flatHierarchy(pages);
  assert.deepEqual(hierarchyLevelSizes(nodes, stride), [1, 2]);
  // Une seule feuille : la racine EST la feuille, un seul étage.
  const petite = flatHierarchy(pages.slice(0, 4));
  assert.deepEqual(hierarchyLevelSizes(petite.nodes, petite.stride), [1]);
  // Aucune page : une racine feuille vide, toujours un étage, jamais zéro passe.
  const vide = flatHierarchy([]);
  assert.deepEqual(hierarchyLevelSizes(vide.nodes, vide.stride), [1]);
  assert.deepEqual(hierarchyLevelSizes(new Float64Array(0), stride), []);
});
