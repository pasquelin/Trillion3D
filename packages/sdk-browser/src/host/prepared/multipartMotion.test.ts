import test from 'node:test';
import assert from 'node:assert/strict';
import { preparedGraph } from './graph.ts';
import { uniqueNames } from './nodes.ts';
import { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts';
import { BufferAttribute } from '../../../../sdk-core/src/world/buffer/attribute.ts';
import { animation } from '../../../../sdk-core/src/world/animation/index.ts';
import { GraphSurface } from '../graph/surface.ts';
import type { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts';
import type {
  PreparedSceneTables,
  TableNode,
} from '../../../../sdk-core/src/scene/core/tableContracts.ts';
import type { TableDocument } from '../../../../sdk-core/src/scene/core/tableDocuments.ts';

const node = (name: string): TableNode => ({
  name,
  children: [],
  mesh: 0,
  light: null,
  camera: null,
  skin: null,
  weights: null,
  matrix: null,
  translation: null,
  rotation: null,
  scale: null,
  visible: true,
});

test('a reused multipart morph mesh animates only the targeted instance through the real mixer', async () => {
  const tables = {
    scene: { name: '', nodes: [0, 1] },
    nodes: [node('first'), node('second')],
    skins: [],
    animations: [
      {
        name: 'morph-second',
        channels: [
          { node: 1, path: 'weights', times: [0, 1], values: [0, 1], interpolation: 'LINEAR' },
        ],
      },
    ],
  } as unknown as PreparedSceneTables;
  const graph = await preparedGraph({
    tables,
    meshes: [
      { name: 'parts', weights: [0], primitives: [{ material: 0 }, { material: 0 }] },
    ] as unknown as TableDocument['meshes'],
    geometryOf: () => {
      const geometry = new Geometry();
      geometry.setAttribute('position', new BufferAttribute(new Float32Array(9), 3));
      geometry.morphAttributes.position = [new BufferAttribute(new Float32Array(9), 3)];
      return geometry;
    },
    materialOf: () => Promise.resolve(new GraphSurface('standard')),
  });
  const mixer = animation.createMixer(graph.scene);
  const action = mixer.clipAction(graph.clips[0]);
  action.loop = 'once';
  action.seek(0.5);
  const weights = graph.nodes.map((node) =>
    node.children.map((part) => (part as Mesh).morphTargetInfluences![0]),
  );
  assert.deepEqual(weights, [
    [0, 0],
    [0.5, 0.5],
  ]);
  action.seek(1);
  assert.deepEqual(
    graph.nodes[1].children.map((part) => (part as Mesh).morphTargetInfluences![0]),
    [1, 1],
  );
  mixer.stopAll();
});

test('generated unique names do not collide with explicit suffix names', () => {
  const unique = uniqueNames();
  const names = ['part', 'part_1', 'part', 'part_2', 'part_1'].map(unique);
  assert.equal(new Set(names).size, names.length);
});
