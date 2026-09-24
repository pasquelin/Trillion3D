import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createAutonomousInstances } from './instances.ts';
import { createAutonomousGeometry } from './geometry.ts';
import type { GraphScene } from '../../host/graph/scene.ts';
import type { HostMaterial } from '../../host/resources.ts';
import type { PageRec } from '../../page/selection/selection.ts';

// An instance copies the geometry of every record the model owns, and shares the one rows place,
// as the store gives it (`geometry.ts`): moving or removing an instance leaves the model and the
// other instances as they are.
test('an instance changed or removed leaves the model and the other instances as they are', () => {
  const geometryOf = () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(3), 1));
    return geometry;
  };
  const record = (clusterId: string, placement?: object) =>
    ({
      url: 'p.bin',
      clusterId,
      matrix: { elements: new Float64Array(new THREE.Matrix4().toArray()) },
      geometry: geometryOf(),
      array: new Uint32Array(3),
      mesh: undefined,
      attached: false,
      placement,
    }) as unknown as PageRec;
  const own = record('prim/0'),
    rowed = record('prim/1', {});
  const bytes = (geometry: unknown) =>
    (geometry as THREE.BufferGeometry).index!.array.byteLength +
    (geometry as THREE.BufferGeometry).attributes.position.array.byteLength;
  const allPages = [own, rowed],
    byUrl = new Map([['p.bin', [own, rowed]]]),
    baseMaterials = new Map<PageRec, HostMaterial>([
      [own, {} as HostMaterial],
      [rowed, {} as HostMaterial],
    ]);
  const geometryStore = createAutonomousGeometry({
    scene: { add: () => {}, remove: () => {} } as unknown as GraphScene,
    allPages,
    bootstrap: [],
    shown: [],
    desired: [],
    byUrl,
    descriptors: new Map(),
    baseMaterials,
    colorMaterials: new Map(),
    modifiedPages: new Set(),
  });
  const { state } = geometryStore;
  state.allocationBytes = bytes(own.geometry) + bytes(rowed.geometry);
  const instances = createAutonomousInstances({
    roots: [],
    baseRoots: [],
    allPages,
    basePages: [own, rowed],
    bootstrap: [],
    baseBootstrap: [],
    byUrl,
    baseMaterials,
    geometryStore,
    cap: 10,
    sceneChanged: () => {},
    coverChanged: () => {},
  });
  const before = state.allocationBytes;
  instances.addInstance('a', new THREE.Matrix4().toArray(new Float64Array(16)));
  instances.addInstance('b', new THREE.Matrix4().toArray(new Float64Array(16)));
  const [, , aOwn, aRowed, bOwn, bRowed] = byUrl.get('p.bin')!;
  assert.notEqual(aOwn.geometry, own.geometry, 'an owned geometry is copied');
  assert.notEqual(aOwn.geometry, bOwn.geometry);
  assert.equal(aRowed.geometry, rowed.geometry, 'rows share the page geometry');
  assert.equal(bRowed.geometry, rowed.geometry);
  assert.equal(state.allocationBytes, before + 2 * bytes(own.geometry), 'one copy an instance');
  // Moving `a` moves its own records only.
  const still = [own, rowed, bOwn, bRowed].map((rec) => Array.from(rec.matrix.elements));
  instances.updateInstance(
    'a',
    new THREE.Matrix4().makeTranslation(4, 0, 0).toArray(new Float64Array(16)),
  );
  assert.equal(aOwn.matrix.elements[12], 4);
  assert.equal(aRowed.matrix.elements[12], 4);
  assert.deepEqual(
    [own, rowed, bOwn, bRowed].map((rec) => Array.from(rec.matrix.elements)),
    still,
    'the model and `b` do not move',
  );
  // Removing `a` gives back its copy and nothing the model or `b` draws.
  let disposed = 0;
  for (const geometry of [own.geometry, rowed.geometry, bOwn.geometry])
    (geometry as unknown as THREE.BufferGeometry).addEventListener('dispose', () => disposed++);
  instances.removeInstance('a');
  assert.deepEqual(byUrl.get('p.bin'), [own, rowed, bOwn, bRowed]);
  assert.equal(disposed, 0, 'no geometry of the model or of `b` is freed');
  assert.equal(state.allocationBytes, before + bytes(own.geometry));
  assert.ok(bOwn.geometry && bRowed.geometry === rowed.geometry);
});
