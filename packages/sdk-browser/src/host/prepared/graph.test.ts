import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  PreparedSceneTables,
  TableNode,
} from '../../../../sdk-core/src/scene/core/tableContracts.ts';
import type { TableDocument } from '../../../../sdk-core/src/scene/core/tableDocuments.ts';
import { BufferAttribute } from '../../../../sdk-core/src/world/buffer/attribute.ts';
import { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts';
import type { HostMesh } from '../resources.ts';
import { GraphSurface } from '../graph/surface.ts';
import { preparedGraph } from './graph.ts';
import { shownChain } from '../../placement/hidden.ts';
import { visMaterial } from '../../visibility/shader/material.ts';
import { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts';

/** A scene of one node drawing one mesh of two primitives, with the morph weights it declares. */
function oneNode(name: string, weights: number[] | null, visible = true) {
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
    visible,
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
    const geometry = new Geometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(9), 3));
    geometry.morphAttributes.position = [new BufferAttribute(new Float32Array(9), 3)];
    return geometry;
  };
  const materialOf = () => Promise.resolve(new GraphSurface('standard'));
  const { scene } = await preparedGraph({ tables, meshes, geometryOf, materialOf });
  const parts: HostMesh[] = [];
  scene.traverse((part) => part instanceof Mesh && parts.push(part));
  assert.equal(parts.length, 2);
  for (const part of parts) assert.deepEqual(part.morphTargetInfluences, [0.5]);
});

// #347: a compiled glTF primitive with `COLOR_0` wears the vertex-coloured variant of its
// surface, which the engine record reads and a WebGPU row multiplies by (`pageRow.test.ts`).
test('a primitive that carries COLOR_0 asks for the vertex-coloured variant of its surface', async () => {
  const { tables, meshes } = oneNode('painted', null);
  const geometryOf = (_rank: number, primitive: number) => {
    const geometry = new Geometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(9), 3));
    if (primitive === 0)
      geometry.setAttribute('color', new BufferAttribute(new Float32Array(12), 4));
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
    (part) => part instanceof Mesh && records.push(visMaterial(part.material).vertexColors),
  );
  assert.deepEqual(records, [true, false]);
});

// #519: a node declaring `KHR_node_visibility` `visible: false` is built hidden, so the pages it
// draws are parked by the one hide/show path (`followHostVisibility`) until a page shows it.
test('a node the table says hidden is built hidden, every primitive it draws with it', async () => {
  const geometryOf = () => {
    const geometry = new Geometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(9), 3));
    return geometry;
  };
  const materialOf = () => Promise.resolve(new GraphSurface('standard'));
  for (const visible of [true, false]) {
    const { tables, meshes } = oneNode('piece', null, visible);
    const { scene } = await preparedGraph({ tables, meshes, geometryOf, materialOf });
    const parts: HostMesh[] = [];
    scene.traverse((part) => part instanceof Mesh && parts.push(part));
    assert.equal(parts.length, 2);
    for (const part of parts) assert.equal(shownChain(part), visible, `visible ${visible}`);
  }
});

// #519: a mesh one hidden core node names is its node, hidden; the cells' copies of that same mesh
// place shown nodes only, so they are built visible.
test('a mesh a hidden core node names is placed visible by the cells', async () => {
  const { tables, meshes } = oneNode('hidden', null, false);
  const single = [{ ...meshes[0], primitives: [{ material: 0 }] }] as typeof meshes;
  const partition = { bounds: [0, 0, 0, 1, 1, 1], meshes: [0], cells: [] };
  const geometryOf = () => {
    const geometry = new Geometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(9), 3));
    return geometry;
  };
  const materialOf = () => Promise.resolve(new GraphSurface('standard'));
  const { scene } = await preparedGraph({
    tables: { ...tables, partition } as PreparedSceneTables,
    meshes: single,
    geometryOf,
    materialOf,
  });
  assert.deepEqual(
    scene.children.map((part) => part.visible),
    [false, true],
  );
});
