import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decodeCollisionMesh,
  encodeCollisionMesh,
} from '../../../../../site/examples/kit/openworld/play/collision.ts';
import { FOOT } from '../../../../../site/examples/kit/openworld/play/sim/foot.ts';
import { box, prop, sharedProps, SURFACES, transform, triangleCount } from '../props/index.ts';
import { churchSquare } from '../regions/countryside/church.ts';
import { collisionMesh } from './collision.ts';

const props = [...sharedProps(332), churchSquare()[0]];

test('a collision mesh is the same bytes every build, and reads back as written', () => {
  for (const mesh of props) {
    const first = collisionMesh(mesh);
    if (!first) continue;
    const bytes = encodeCollisionMesh(first);
    assert.deepEqual(encodeCollisionMesh(collisionMesh(mesh)!), bytes, mesh.id);
    assert.deepEqual(decodeCollisionMesh(bytes.slice().buffer), first, mesh.id);
  }
  const wrong = encodeCollisionMesh(collisionMesh(props.at(-1)!)!);
  wrong[4] = 9;
  assert.throws(() => decodeCollisionMesh(wrong.buffer), /unknown format/);
});

test('no prop collides with more triangles than it draws; plants and specks do not collide', (t) => {
  let [drawn, solid] = [0, 0];
  for (const mesh of props) {
    const collision = collisionMesh(mesh),
      count = collision ? collision.indices.length / 3 : 0;
    assert.ok(count <= triangleCount(mesh), `${mesh.id}: ${count} of ${triangleCount(mesh)}`);
    if (/^(tree|bush)-/.test(mesh.id)) assert.equal(collision, undefined, mesh.id);
    drawn += triangleCount(mesh);
    solid += count;
  }
  t.diagnostic(`${solid} collision triangles for ${drawn} drawn`);
  const speck = FOOT.radius * 0.9,
    pebble = prop('pebble', [box(SURFACES.concrete, [speck, speck, speck])]),
    wall = prop('wall', [
      box(SURFACES.concrete, [4, 2, 0.2]),
      transform(box(SURFACES.concrete, [speck, speck, speck]), { at: [0, 3, 0] }),
    ]);
  assert.equal(collisionMesh(pebble), undefined);
  // The wall, thinner than the walker, may fold to a sheet; the speck above it is gone.
  const kept = collisionMesh(wall)!.positions;
  assert.ok(kept.length > 0 && kept.every((v, i) => i % 3 !== 1 || v <= 2), 'the wall alone');
});

test("the church square's square is its floor, not its spire", () => {
  const { positions } = collisionMesh(churchSquare()[0])!,
    heights = positions.filter((_, i) => i % 3 === 1);
  assert.ok(Math.max(...heights) > 40, 'the spire is kept');
  assert.ok(
    heights.some((y) => Math.abs(y - 0.3) < 0.1),
    'the square is kept at its height',
  );
});
