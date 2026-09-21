import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { clusterMaterialReason } from './webglClusterCompatibility.ts';
import { validateClusterMeshes } from './webglClusterValidation.ts';
import { drawPasses } from './clusterBatchMesh.ts';

const position = new THREE.BufferAttribute(new Float32Array(9), 3);
const NO_COPIES = { plain: [], blended: [], transmissive: [] };

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

test('a normal-mapped material needs no tangent attribute: the shader rebuilds the frame', () => {
  const material = new THREE.MeshStandardMaterial({ normalMap: new THREE.Texture({}) });
  assert.equal(
    clusterMaterialReason(material, {
      position,
      normal: new THREE.BufferAttribute(new Float32Array(9), 3),
      uv: new THREE.BufferAttribute(new Float32Array(6), 2),
    }),
    undefined,
  );
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
        NO_COPIES,
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
        NO_COPIES,
        new Map(),
      ),
    /material arrays are unsupported/,
  );
});

test('a mutation of a two-sided transparent material is read at the draw, never frozen', () => {
  const source = new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide });
  const mesh = { material: source, geometry: { attributes: { position } } } as never;
  assert.deepEqual(drawPasses(source), ['back', 'front']);
  validateClusterMeshes([mesh], [], NO_COPIES, new Map());
  source.forceSinglePass = true;
  assert.deepEqual(drawPasses(source), [undefined], 'one pass on the declared faces');
  source.premultipliedAlpha = true;
  assert.throws(
    () => validateClusterMeshes([mesh], [], NO_COPIES, new Map()),
    /unsupported blend state/,
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
  plain.ior = 1.3;
  assert.match(clusterMaterialReason(plain, { position, normal })!, /ior without transmission/);
  glass.ior = 1.3;
  assert.equal(clusterMaterialReason(glass, { position, normal }, true), undefined);
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
  const copies = { ...NO_COPIES, transmissive: [copy] };
  validateClusterMeshes([], [], copies, new Map());
  glass.sheen = 1;
  assert.throws(() => validateClusterMeshes([], [], copies, new Map()), /sheen/);
  glass.sheen = 0;
  // A blended copy the owner submits is validated like a page: it never transmits.
  assert.throws(
    () => validateClusterMeshes([], [], { ...NO_COPIES, blended: [copy] }, new Map()),
    /drawn as a scene copy/,
  );
});
