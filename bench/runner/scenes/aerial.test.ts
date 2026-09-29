import test from 'node:test';
import assert from 'node:assert/strict';
import { aerialScene } from './aerial.ts';
import { groundTile, lathe, PROPS } from './aerialModel.ts';

test('the aerial scene places thousands of nodes on a few shared props', () => {
  const { gltf, counts } = aerialScene(410, 3600, 600);
  const byMesh = new Map<number, number>();
  for (const node of gltf.nodes)
    if (typeof node.mesh === 'number') byMesh.set(node.mesh, (byMesh.get(node.mesh) ?? 0) + 1);
  const props = [...byMesh.values()].filter((count) => count > 1);
  assert.equal(props.length, PROPS.length);
  assert.equal(
    props.reduce((a, b) => a + b, 0),
    3600,
  );
  assert.equal(gltf.nodes.filter((node) => node.extensions).length, 600);
  assert.ok(counts.instanced > 25e6 && counts.instanced < 45e6, `${counts.instanced}`);
  assert.ok(counts.source < 1e6, `${counts.source}`);
  assert.deepEqual(aerialScene(410, 10, 1).gltf, aerialScene(410, 10, 1).gltf);
});

test('two neighbouring ground tiles share their edge, heights and normals alike', () => {
  const [size, cells] = [500, 8],
    west = groundTile(0, 0, size, cells, 120),
    east = groundTile(size, 0, size, cells, 120),
    row = cells + 1;
  for (let j = 0; j < row; j++) {
    const [a, b] = [(j * row + cells) * 3, j * row * 3];
    assert.equal(west.positions[a + 1], east.positions[b + 1]);
    assert.deepEqual(west.normals.slice(a, a + 3), east.normals.slice(b, b + 3));
  }
});

test('a lathed prop faces outward and reaches the triangle count its profile asks', () => {
  const shape = lathe(
    [
      [1, 0],
      [1, 2],
      [0, 3],
    ],
    16,
    4,
  );
  assert.equal(shape.indices.length / 3, 2 * 16 * 2 * 4);
  for (let v = 0; v < shape.positions.length; v += 3) {
    const [x, , z] = shape.positions.subarray(v, v + 3);
    if (Math.hypot(x, z) < 0.5) continue;
    assert.ok(x * shape.normals[v] + z * shape.normals[v + 2] > 0, `vertex ${v / 3} faces in`);
  }
});
