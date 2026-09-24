import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  PreparedSceneTables,
  TableNode,
} from '../../../../sdk-core/src/scene/core/tableContracts.ts';
import type { TableDocument } from '../../../../sdk-core/src/scene/core/tableDocuments.ts';
import { GraphAttribute } from '../graph/attributes.ts';
import { GraphGeometry } from '../graph/geometry.ts';
import { GraphMesh } from '../graph/mesh.ts';
import { GraphSurface } from '../graph/surface.ts';
import { preparedGraph } from './graph.ts';

test('weights a node declares reach every primitive of its mesh, the group holding them skipped', async () => {
  const node: TableNode = {
    name: 'morphed',
    children: [],
    mesh: 0,
    light: null,
    camera: null,
    weights: [0.5],
    matrix: null,
    translation: null,
    rotation: null,
    scale: null,
  };
  const tables = {
    scene: { name: '', nodes: [0] },
    nodes: [node],
  } as unknown as PreparedSceneTables;
  const meshes = [
    { name: 'mesh', weights: null, primitives: [{ material: 0 }, { material: 0 }] },
  ] as unknown as TableDocument['meshes'];
  const geometryOf = () => {
    const geometry = new GraphGeometry();
    geometry.setAttribute('position', new GraphAttribute(new Float32Array(9), 3));
    geometry.morphAttributes.position = [new GraphAttribute(new Float32Array(9), 3)];
    return geometry;
  };
  const materialOf = () => Promise.resolve(new GraphSurface('standard'));
  const { scene } = await preparedGraph({ tables, meshes, geometryOf, materialOf });
  const parts: GraphMesh[] = [];
  scene.traverse((part) => part instanceof GraphMesh && parts.push(part));
  assert.equal(parts.length, 2);
  for (const part of parts) assert.deepEqual(part.morphTargetInfluences, [0.5]);
});
