import * as THREE from 'three';
import type { WebglClusterRenderer } from '../../packages/sdk-browser/webglClusterRenderer.ts';

type ClusterMeshFactory = typeof import('./webglClusterPixels.ts').clusterRecord;
type DrawParams = Parameters<WebglClusterRenderer['draw']>;
type GeometryFactory = (reverseFirst?: boolean) => THREE.BufferGeometry;

function coplanarBlendMesh(geometry: GeometryFactory, mesh: ClusterMeshFactory, biased: boolean) {
  const source = new THREE.MeshBasicMaterial({
      color: 0x00ff00,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      depthFunc: THREE.LessDepth,
      side: THREE.DoubleSide,
    }),
    back = source.clone(),
    front = source.clone();
  back.side = THREE.BackSide;
  front.side = THREE.FrontSide;
  for (const pass of biased ? [back, front] : []) {
    pass.polygonOffset = true;
    pass.polygonOffsetFactor = 0;
    pass.polygonOffsetUnits = -8;
  }
  const pair: [THREE.Material, THREE.Material] = [back, front],
    result = mesh(geometry(true), pair, [0], [3]);
  result._sideSplitMaterials = pair;
  result._sideSplitBack = back;
  result._sideSplitFront = front;
  result._sideSplitSource = source;
  result._sideSplitPolygonMaterials = biased ? pair : undefined;
  return result;
}

export function drawCoplanarBlend(
  renderer: WebglClusterRenderer,
  scene: DrawParams[1],
  camera: DrawParams[2],
  geometry: GeometryFactory,
  mesh: ClusterMeshFactory,
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
