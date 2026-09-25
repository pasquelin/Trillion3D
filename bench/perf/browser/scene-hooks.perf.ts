// Performance bench: the host scene watch on a large graph of the engine's own nodes.
// The watch hooks a node by chaining a listener on its position, scale and rotation (`listen`),
// which each write of those values calls; no field of the node is redefined. Those listeners must
// not slow the matrix walk over the nodes: the listener-hooked graph is walked against its plain
// twin, the witness, and the plain graph is walked as a case too, its gap to the witness being the
// spread the hooked row is read against. The read the watch does per frame over the same nodes is
// measured on its own.
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts';
import { mesure, rapport } from '../../core/index.ts';
import { createHostSceneWatch } from '../../../packages/sdk-browser/src/host/scene/watch.ts';

const NODES = 20000;
const GROUPS = 200;

/** `NODES` meshes under `GROUPS` groups, every pose distinct, matrices left to recompose. */
function graph() {
  const root = new G.Group();
  const meshes = [];
  for (let g = 0; g < GROUPS; g++) {
    const group = new G.Group();
    group.position.set(g, 0, -g);
    root.add(group);
    for (let i = 0; i < NODES / GROUPS; i++) {
      const mesh = G.mesh();
      mesh.position.set(i, g, i + g);
      mesh.rotation.y = (i + g) * 1e-3;
      const stretch = 1 + (i % 7) * 0.1;
      mesh.scale.set(stretch, stretch, stretch);
      group.add(mesh);
      meshes.push(mesh);
    }
  }
  return { root, meshes };
}

/** The graph, hooked as the frame gate hooks it: every drawn source node and its ancestors. */
function hooked() {
  const scene = graph();
  const watch = createHostSceneWatch();
  watch.observe(
    scene.root,
    scene.meshes.map((sourceMesh) => ({ sourceMesh })),
  );
  watch.take();
  return { ...scene, watch };
}

/** The world matrices of one mesh in two hundred, after a forced walk of the whole graph. */
function walk({ root, meshes }: { root: G.Group; meshes: G.GraphMesh[] }) {
  root.updateMatrixWorld(true);
  const sample = new Float64Array((meshes.length / 200) * 16);
  for (let i = 0; i < meshes.length; i += 200)
    sample.set(meshes[i].matrixWorld.elements, (i / 200) * 16);
  return sample;
}

const plain = graph();
const options = { chauffe: 5, tours: 40, budgetMs: 4000 };

const walks = await mesure({
  name: 'updateMatrixWorld(true) over listener-hooked nodes',
  fichier: [
    'packages/sdk-browser/src/host/scene/hooks.ts',
    'packages/sdk-core/src/world/math/observed.ts',
  ],
  cas: [
    { name: `${NODES} listener-hooked nodes`, input: hooked(), size: NODES },
    { name: `${NODES} plain nodes`, input: graph(), size: NODES },
  ],
  calcul: walk,
  temoin: () => walk(plain),
  attendu: () => walk(plain),
  options,
});

const still = hooked();
const written = hooked();
let frame = 0;
const reads = await mesure({
  name: 'watch.take() per frame',
  fichier: [
    'packages/sdk-browser/src/host/scene/watch.ts',
    'packages/sdk-browser/src/host/scene/scan.ts',
  ],
  cas: [
    { name: `${NODES} nodes, still scene`, input: still, size: NODES },
    { name: `${NODES} nodes, one pose written per frame`, input: written, size: NODES },
  ],
  calcul: (scene) => {
    if (scene === written) scene.meshes[frame++ % NODES].position.x += 1;
    return scene.watch.take();
  },
  motif: 'a still scene takes 0, one write takes `moved`: what the frame gate compares',
  options,
});

rapport('scene-hooks', [walks, reads], 'the hooked graph walks to the bits of its plain twin');
