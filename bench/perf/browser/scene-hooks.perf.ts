// Performance bench: the host scene watch on a large graph (Three.js as the witness).
// The hooks a watch puts on the host's nodes must not slow the reference's own matrix walk
// over them: a host that also renders its graph with Three pays that walk every frame. The
// hooked graph is walked against a plain twin; a refused candidate — accessors redefined on
// the instance, which V8 answers with dictionary mode — is measured for the record. The read
// the watch does per frame over the same nodes is measured on its own.
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

/** The refused candidate: the pose fields redefined as accessors of each instance. */
function instanceAccessors() {
  const scene = graph();
  scene.root.traverse((node) => {
    for (const vector of [node.position, node.scale])
      for (const key of ['x', 'y', 'z'] as const) {
        let held = vector[key];
        Object.defineProperty(vector, key, {
          configurable: true,
          enumerable: true,
          get: () => held,
          set: (value) => {
            held = value;
          },
        });
      }
    let visible = node.visible;
    Object.defineProperty(node, 'visible', {
      configurable: true,
      enumerable: true,
      get: () => visible,
      set: (value) => {
        visible = value;
      },
    });
  });
  return scene;
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
  name: 'updateMatrixWorld(true) over hooked nodes',
  fichier: [
    'packages/sdk-browser/src/host/scene/hookCore.ts',
    'packages/sdk-browser/src/host/scene/hooks.ts',
  ],
  cas: [
    { name: `${NODES} nodes hooked on the prototype`, input: hooked(), size: NODES },
    {
      name: `${NODES} nodes with accessors on the instance (refused)`,
      input: instanceAccessors(),
      size: NODES,
    },
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
