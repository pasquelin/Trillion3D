import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { clusterMaterialReason } from './webglClusterCompatibility.ts';
import { validateClusterMeshes } from './webglClusterValidation.ts';

const position = new THREE.BufferAttribute(new Float32Array(9), 3);

test('an untextured Basic material needs no unused UV or normal attribute', () => {
  assert.equal(clusterMaterialReason(new THREE.MeshBasicMaterial(), { position }), undefined);
});

test('unsupported mutations refuse the autonomous draw before it becomes partial', () => {
  const material = new THREE.MeshStandardMaterial();
  assert.equal(
    clusterMaterialReason(material, { position }),
    'lit material has no normal attribute',
  );
  material.transparent = true;
  assert.equal(
    clusterMaterialReason(material, {
      position,
      normal: new THREE.BufferAttribute(new Float32Array(9), 3),
    }),
    undefined,
  );
  material.premultipliedAlpha = true;
  assert.match(clusterMaterialReason(material, { position })!, /unsupported blend state/);
  material.premultipliedAlpha = false;
  material.transparent = false;
  material.wireframe = true;
  assert.match(clusterMaterialReason(material, { position })!, /unsupported extension/);
  material.wireframe = false;
  material.alphaMap = new THREE.Texture({});
  assert.match(clusterMaterialReason(material, { position })!, /unsupported extension/);
});

test('a texture selecting UV1 is refused when geometry has only UV0', () => {
  const material = new THREE.MeshBasicMaterial({ map: new THREE.Texture({}) });
  material.map!.channel = 1;
  assert.match(
    clusterMaterialReason(material, {
      position,
      uv: new THREE.BufferAttribute(new Float32Array(6), 2),
    })!,
    /no UV1 attribute/,
  );
});

test('one material is validated against every distinct geometry attribute set', () => {
  const material = new THREE.MeshBasicMaterial({ map: new THREE.Texture({}) });
  material.map!.channel = 1;
  const uv = new THREE.BufferAttribute(new Float32Array(6), 2);
  assert.throws(
    () =>
      validateClusterMeshes(
        [
          { material, geometry: { attributes: { position, uv, uv1: uv } } },
          { material, geometry: { attributes: { position, uv } } },
        ] as never,
        [],
        [],
        [],
        new Map(),
      ),
    /no UV1 attribute/,
  );
});

test('a runtime mutation to a material array is rejected instead of disappearing', () => {
  const material = new THREE.MeshBasicMaterial();
  assert.throws(
    () =>
      validateClusterMeshes(
        [{ material: [material], geometry: { attributes: { position } } }] as never,
        [],
        [],
        [],
        new Map(),
      ),
    /material arrays are unsupported/,
  );
});

test('mutating one generated sideSplit pass is refused before either pass draws', () => {
  const source = new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide });
  const back = new THREE.MeshBasicMaterial({ transparent: true, side: THREE.BackSide });
  const front = new THREE.MeshBasicMaterial({ transparent: true, side: THREE.FrontSide });
  const pair = [back, front] as [THREE.Material, THREE.Material];
  const mesh = {
    material: pair,
    geometry: { attributes: { position } },
    _sideSplitMaterials: pair,
    _sideSplitBack: back,
    _sideSplitFront: front,
    _sideSplitSource: source,
  };
  pair[0] = new THREE.MeshBasicMaterial({ transparent: true, side: THREE.BackSide });
  assert.throws(
    () => validateClusterMeshes([mesh] as never, [], [], [], new Map()),
    /invalid sideSplit/,
  );
});

test('mutating a sideSplit source to an unsupported state is refused', () => {
  const source = new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide });
  const back = source.clone(),
    front = source.clone();
  back.side = THREE.BackSide;
  front.side = THREE.FrontSide;
  const pair = [back, front] as [THREE.Material, THREE.Material];
  const mesh = {
    material: pair,
    geometry: { attributes: { position } },
    _sideSplitMaterials: pair,
    _sideSplitBack: back,
    _sideSplitFront: front,
    _sideSplitSource: source,
  };
  source.premultipliedAlpha = true;
  assert.throws(
    () => validateClusterMeshes([mesh] as never, [], [], [], new Map()),
    /unsupported blend state/,
  );
  source.premultipliedAlpha = false;
  source.forceSinglePass = true;
  assert.throws(
    () => validateClusterMeshes([mesh] as never, [], [], [], new Map()),
    /mutated sideSplit source/,
  );
});

test('a transmissive physical material is a scene copy of the transmission pass, never a cluster', () => {
  const normal = new THREE.BufferAttribute(new Float32Array(9), 3);
  const glass = new THREE.MeshPhysicalMaterial({ transmission: 1, ior: 1.5, thickness: 0.1 });
  assert.match(clusterMaterialReason(glass, { position, normal })!, /drawn as a scene copy/);
  assert.equal(clusterMaterialReason(glass, { position, normal }, true), undefined);
  const plain = new THREE.MeshPhysicalMaterial();
  assert.equal(clusterMaterialReason(plain, { position, normal }), undefined);
  assert.equal(clusterMaterialReason(plain, { position, normal }, true), undefined);
  glass.clearcoat = 0.5;
  assert.match(clusterMaterialReason(glass, { position, normal }, true)!, /clearcoat/);
  glass.clearcoat = 0;
  glass.thicknessMap = new THREE.Texture({});
  assert.match(clusterMaterialReason(glass, { position, normal }, true)!, /thicknessMap/);
});

test('a transmissive copy mutated into another physical extension is refused before drawing', () => {
  const normal = new THREE.BufferAttribute(new Float32Array(9), 3);
  const glass = new THREE.MeshPhysicalMaterial({ transmission: 1 });
  const copy = { material: glass, geometry: { attributes: { position, normal } } } as never;
  validateClusterMeshes([], [], [], [copy], new Map());
  glass.sheen = 1;
  assert.throws(() => validateClusterMeshes([], [], [], [copy], new Map()), /sheen/);
});
