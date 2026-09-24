// The pose writes the contract lets the host make on a node each increment the revision of
// the watch that hooked it, at the instant of the write; a write of the value already held
// increments nothing. The hook redefines no field of an existing object: the node and its
// vectors keep the fast shape the reference's matrix walk relies on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as G from '../graph/graph.fixture.ts';
import { hookHostNode, unhookHostNode } from './hooks.ts';
import type { WriteRevision } from './hookCore.ts';

const mark = (): WriteRevision => ({ revision: 0 });

function hooked() {
  const parent = new G.GraphGroup();
  const mesh = G.mesh();
  parent.add(mesh);
  const revision = mark();
  for (const node of [parent, mesh]) hookHostNode(node, revision);
  return { parent, mesh, revision };
}

type Scene = ReturnType<typeof hooked>;
/** The pose paths of a node: each bumps, and repeated as-is bumps nothing. */
const WRITES: Array<{ name: string; write: (s: Scene) => void }> = [
  { name: 'a position component', write: ({ mesh }) => void (mesh.position.x = 100) },
  { name: 'position.set', write: ({ mesh }) => void mesh.position.set(1, 2, 3) },
  { name: 'scale.set', write: ({ mesh }) => void mesh.scale.set(2, 2, 2) },
  { name: 'a rotation Euler component', write: ({ mesh }) => void (mesh.rotation.y = 1) },
  {
    name: 'quaternion.setFromAxisAngle',
    write: ({ mesh }) =>
      void mesh.quaternion.copy(new G.Quaternion().setFromAxisAngle(new G.Vector3(0, 1, 0), 1)),
  },
  { name: 'an ancestor pose', write: ({ parent }) => void (parent.position.z = -4) },
];

for (const { name, write } of WRITES)
  test(`a write of ${name} bumps the revision`, () => {
    const scene = hooked();
    write(scene);
    assert.ok(scene.revision.revision > 0, 'a write, an increment');
    scene.revision.revision = 0;
    write(scene);
    assert.equal(scene.revision.revision, 0, 'the same value written again is not a change');
  });

test('a vector the host kept from before the hook still drives the node, and is seen', () => {
  const mesh = G.mesh();
  const kept = mesh.position;
  const revision = mark();
  hookHostNode(mesh, revision);
  kept.x = 5;
  kept.fromArray([5, 6, 7]);
  assert.equal(revision.revision, 2, 'each write through the kept object bumps');
  assert.deepEqual(G.xyz(mesh.position), [5, 6, 7], 'the node reads what was written');
  assert.deepEqual(G.xyz(kept), [5, 6, 7], 'and the kept object reads the node');
});

test('a hooked node and its vectors keep fast properties for the reference to walk', () => {
  const probe = `
    import * as G from ${JSON.stringify(new URL('../graph/graph.fixture.ts', import.meta.url).href)};
    import { hookHostNode } from ${JSON.stringify(new URL('./hooks.ts', import.meta.url).href)};
    const mesh = G.mesh();
    hookHostNode(mesh, { revision: 0 });
    mesh.position.x = 1;
    console.log(JSON.stringify([mesh, mesh.position, mesh.scale].map((o) => %HasFastProperties(o))));`;
  const run = spawnSync(
    process.execPath,
    ['--allow-natives-syntax', '--experimental-strip-types', '--input-type=module', '-e', probe],
    { encoding: 'utf8', cwd: new URL('.', import.meta.url) },
  );
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout), [true, true, true], 'mesh, position, scale');
});

test('two watches on one node are both bumped; an unhooked one no longer is', () => {
  const { mesh, revision } = hooked();
  const other = mark();
  hookHostNode(mesh, other);
  hookHostNode(mesh, other);
  mesh.position.x = 1;
  assert.deepEqual([revision.revision, other.revision], [1, 1], 'registered once, bumped once');
  unhookHostNode(mesh, other);
  unhookHostNode(mesh, other);
  mesh.position.x = 2;
  assert.deepEqual([revision.revision, other.revision], [2, 1]);
});

test('a node every watch has left reaches none, and hooks again for the next', () => {
  const { mesh, revision } = hooked();
  unhookHostNode(mesh, revision);
  mesh.position.x = 9;
  mesh.rotation.y = 1;
  assert.equal(revision.revision, 0, 'no write reaches the watch any more');
  assert.equal(mesh.quaternion.y !== 0, true, 'the Euler still drives the quaternion');
  const next = mark();
  hookHostNode(mesh, next);
  mesh.position.x = 10;
  assert.equal(next.revision, 1);
});

test('the hooked fields read back what was written, for the host and for the reference', () => {
  const { mesh } = hooked();
  mesh.position.set(1, 2, 3);
  mesh.rotation.set(0.1, 0.2, 0.3);
  mesh.scale.set(2, 2, 2);
  const twin = G.mesh();
  twin.position.set(1, 2, 3);
  twin.rotation.set(0.1, 0.2, 0.3);
  twin.scale.set(2, 2, 2);
  mesh.updateMatrix();
  twin.updateMatrix();
  assert.deepEqual(mesh.matrix.elements, twin.matrix.elements, 'the same composed matrix');
  assert.ok(mesh.position instanceof G.Vector3);
  assert.deepEqual(G.xyz(mesh.clone().position), [1, 2, 3], 'a clone copies through the accessors');
});
