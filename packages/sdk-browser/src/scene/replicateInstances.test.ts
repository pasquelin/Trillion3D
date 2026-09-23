// Batch M4a, replicateInstances.ts: world matrices of copies calculated by core's
// `multiplyMatrix4`, flat bounds. Compared bit-by-bit (Object.is) to legacy Three path
// (`Matrix4.copy` then `group.updateMatrixWorld`), including hostile hierarchy.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { replicateInstances } from './replicateInstances.ts';
import { ENGINE_OWNED } from '../host/scene/watch.ts';
import { hostWorldBounds } from '../host/world/bounds.ts';
import { assertBits } from '../../../../tests/kit/assert/bits.ts';

/** Two meshes under negative scale root and non-uniform scale child. */
function hostileSource() {
  const racine = new THREE.Group();
  racine.scale.set(-1, 1, 1);
  const enfant = new THREE.Group();
  enfant.position.set(3, 0, 0);
  enfant.scale.set(1, 2, 0.5);
  racine.add(enfant);
  const a = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  a.position.set(0.5, 0, 0);
  enfant.add(a);
  const b = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  b.position.set(-0.5, 0, 0);
  enfant.add(b);
  return { racine, a, b };
}

/** Legacy path, before batch M4a: `Matrix4.copy` then `group.updateMatrixWorld`. */
function referenceReplicate(
  source: THREE.Object3D,
  associations: Map<THREE.Object3D, unknown>,
  count: 1 | 4 | 9 | 12,
) {
  source.updateMatrixWorld(true);
  if (count === 1) return source;
  const bounds = new THREE.Box3().setFromObject(source);
  const size = new THREE.Vector3();
  bounds.getSize(size);
  const [columns, rows] = count === 12 ? [4, 3] : [Math.sqrt(count), Math.sqrt(count)];
  const group = new THREE.Group();
  const meshes: THREE.Mesh[] = [];
  source.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  for (let z = 0; z < rows; z++)
    for (let x = 0; x < columns; x++)
      for (const mesh of meshes) {
        const copy = new THREE.Mesh(mesh.geometry, mesh.material);
        copy.matrixAutoUpdate = false;
        copy.matrix.copy(mesh.matrixWorld);
        copy.matrix.elements[12] += (x - (columns - 1) / 2) * size.x;
        copy.matrix.elements[14] += (z - (rows - 1) / 2) * size.z;
        group.add(copy);
      }
  group.updateMatrixWorld(true);
  return group;
}

test('replicateInstances(count=1) returns source itself, without copying', () => {
  const { racine } = hostileSource();
  const associations = new Map();
  const rendu = replicateInstances(racine, associations, 1);
  assert.equal(rendu, racine);
});

for (const count of [4, 9, 12] as const) {
  test(`replicateInstances(count=${count}) : world matrices of copies bit-for-bit identical to legacy Three path, hostile source`, () => {
    const obtenu = hostileSource();
    const attendu = hostileSource();
    const groupeObtenu = replicateInstances(obtenu.racine, new Map(), count) as THREE.Group;
    const groupeAttendu = referenceReplicate(attendu.racine, new Map(), count) as THREE.Group;
    assert.equal(groupeObtenu.children.length, groupeAttendu.children.length);
    for (let i = 0; i < groupeObtenu.children.length; i++)
      assertBits(
        (groupeObtenu.children[i] as THREE.Mesh).matrixWorld.elements,
        (groupeAttendu.children[i] as THREE.Mesh).matrixWorld.elements,
      );
  });
}

test('replicateInstances flags each copy ENGINE_OWNED and freezes its matrix (matrixAutoUpdate to false)', () => {
  const { racine } = hostileSource();
  const groupe = replicateInstances(racine, new Map(), 4) as THREE.Group;
  for (const copie of groupe.children as THREE.Mesh[]) {
    assert.equal(copie.userData[ENGINE_OWNED], true);
    assert.equal(copie.matrixAutoUpdate, false);
  }
});

test('replicateInstances transfers association of each source mesh onto its copies', () => {
  const { racine, a, b } = hostileSource();
  const associations = new Map<THREE.Object3D, { meshes: number }>([
    [a, { meshes: 0 }],
    [b, { meshes: 1 }],
  ]);
  const groupe = replicateInstances(racine, associations, 4) as THREE.Group;
  for (const copie of groupe.children as THREE.Mesh[])
    assert.ok(associations.get(copie), 'each copy carries association of its source mesh');
});

test('replicateInstances uses `preparedBounds` as is, without recalculating bounds', () => {
  const { racine } = hostileSource();
  const reelles = hostWorldBounds(racine);
  // Deliberately incorrect bounds (twice as wide): if function ignored them to recalculate
  // its own, grid spacing would match real bounds, not these.
  const fausses = Float64Array.from([
    reelles[0] * 2,
    reelles[1],
    reelles[2],
    reelles[3] * 2,
    reelles[4],
    reelles[5],
  ]);
  const groupe = replicateInstances(racine, new Map(), 4, fausses) as THREE.Group;
  const attenduEspacement = fausses[3] - fausses[0];
  const reelEspacement = reelles[3] - reelles[0];
  const premiere = (groupe.children[0] as THREE.Mesh).matrixWorld.elements[12];
  const derniereColonne = (groupe.children[groupe.children.length - 2] as THREE.Mesh).matrixWorld
    .elements[12];
  assert.notEqual(attenduEspacement, reelEspacement, 'test must use different bounds');
  assert.ok(
    Math.abs(Math.abs(derniereColonne - premiere) - attenduEspacement) < 1e-9,
    'spacing follows `preparedBounds`, not real bounds',
  );
});

test('invalid replica count throws', () => {
  const { racine } = hostileSource();
  assert.throws(() => replicateInstances(racine, new Map(), 2 as 1));
});
