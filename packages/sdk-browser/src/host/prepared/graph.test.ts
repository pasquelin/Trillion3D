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
import { visMaterial } from '../../visibility/shader/material.ts';

/** A scene of one node drawing one mesh of two primitives, with the morph weights it declares. */
function oneNode(name: string, weights: number[] | null) {
  const node: TableNode = {
    name,
    children: [],
    mesh: 0,
    light: null,
    camera: null,
    weights,
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
  return { tables, meshes };
}

test('weights a node declares reach every primitive of its mesh, the group holding them skipped', async () => {
  const { tables, meshes } = oneNode('morphed', [0.5]);
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

// #347: a compiled glTF primitive with `COLOR_0` wears the vertex-coloured variant of its
// surface, which the engine record reads and a WebGPU row multiplies by (`pageRow.test.ts`).
test('a primitive that carries COLOR_0 asks for the vertex-coloured variant of its surface', async () => {
  const { tables, meshes } = oneNode('painted', null);
  const geometryOf = (_rank: number, primitive: number) => {
    const geometry = new GraphGeometry();
    geometry.setAttribute('position', new GraphAttribute(new Float32Array(9), 3));
    if (primitive === 0)
      geometry.setAttribute('color', new GraphAttribute(new Float32Array(12), 4));
    return geometry;
  };
  const variants: boolean[] = [];
  const materialOf = (_rank: number, variant: { vertexColors: boolean }) => {
    variants.push(variant.vertexColors);
    return Promise.resolve(new GraphSurface('standard', { vertexColors: variant.vertexColors }));
  };
  const { scene } = await preparedGraph({ tables, meshes, geometryOf, materialOf });
  assert.deepEqual(variants, [true, false]);
  const records: (boolean | undefined)[] = [];
  scene.traverse(
    (part) => part instanceof GraphMesh && records.push(visMaterial(part.material).vertexColors),
  );
  assert.deepEqual(records, [true, false]);
});
