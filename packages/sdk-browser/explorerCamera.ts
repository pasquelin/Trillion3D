import * as THREE from 'three';
import { meshes as objects } from './sceneMeshes.ts';
import { framingFromBounds } from './framing.ts';
import { DEFAULT_FOV } from './backendCommon.ts';
import type { BackendContext, ExplorerOptions } from './backendTypes.ts';
import type { ClusterManifest } from '../sdk-core/index.ts';

export function createExplorerCamera(
  source: THREE.Object3D,
  autonomous: boolean,
  associations: BackendContext['associations'],
  metadata: ClusterManifest,
  canvas: HTMLCanvasElement,
  options: ExplorerOptions,
) {
  const bounds = new THREE.Box3();
  for (const mesh of objects(source)) {
    if (!autonomous) {
      bounds.expandByObject(mesh);
      continue;
    }
    const association = associations.get(mesh);
    const primitive = metadata.primitives.find(
      (item) =>
        item.mesh === association?.meshes && item.primitive === (association?.primitives ?? 0),
    );
    if (!primitive) continue;
    for (const page of primitive.pages)
      if ((page.role ?? 'exact') === 'exact')
        bounds.union(
          new THREE.Box3(
            new THREE.Vector3().fromArray(page.min),
            new THREE.Vector3().fromArray(page.max),
          ).applyMatrix4(mesh.matrixWorld),
        );
  }
  const center = bounds.getCenter(new THREE.Vector3()),
    radius = bounds.getSize(new THREE.Vector3()).length() / 2;
  if (!Number.isFinite(radius) || radius <= 0) throw new Error('Empty scene bounds');
  const framing = framingFromBounds(radius, canvas.width / canvas.height);
  const camera = new THREE.PerspectiveCamera(
    options.fov ?? DEFAULT_FOV,
    canvas.width / canvas.height,
    framing.near,
    framing.far,
  );
  const homeOffset = new THREE.Vector3().fromArray(framing.offset);
  camera.position.copy(center).add(homeOffset);
  camera.lookAt(center);
  camera.updateMatrixWorld();
  return { bounds, center, radius, camera, homeOffset };
}
