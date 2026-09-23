import * as THREE from 'three';
import type { WebglClusterRenderer } from '../../../packages/sdk-browser/webglClusterRenderer.ts';
import type { WebglClusterScene } from '../../../packages/sdk-browser/webglClusterLights.ts';
import type { ClusterDrawMesh } from '../../../packages/sdk-browser/clusterBatchMesh.ts';
import type { HostDrawCamera } from '../../../packages/sdk-browser/cameraWorld.ts';

/** A geometry factory as the transparency proof's fixtures build it. */
type GeometryFactory = (reverseFirst?: boolean) => THREE.BufferGeometry;
/** A batch record factory as `clusterRecord` builds it. */
type MeshFactory = (
  geometry: THREE.BufferGeometry,
  material: THREE.Material | THREE.Material[],
  starts?: number[],
  counts?: number[],
) => ClusterDrawMesh;

/** A two-sided BLEND record, drawn back then front; `biased`, it carries a layer offset. */
function coplanarBlendMesh(geometry: GeometryFactory, mesh: MeshFactory, biased: boolean) {
  const source = new THREE.MeshBasicMaterial({
    color: 0x00ff00,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    depthFunc: THREE.LessDepth,
    side: THREE.DoubleSide,
  });
  const result = mesh(geometry(true), source, [0], [3]);
  result.polygonOffsetUnits = biased ? -8 : undefined;
  return result;
}

export function drawCoplanarBlend(
  renderer: WebglClusterRenderer,
  scene: WebglClusterScene,
  camera: HostDrawCamera,
  geometry: GeometryFactory,
  mesh: MeshFactory,
  base: THREE.Material,
  biased: boolean,
) {
  return renderer.draw(
    [mesh(geometry(), base, [0], [3]), coplanarBlendMesh(geometry, mesh, biased)],
    scene,
    camera,
    false,
    false,
  );
}
