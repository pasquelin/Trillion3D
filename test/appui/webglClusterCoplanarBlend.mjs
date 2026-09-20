import * as THREE from 'three';

function coplanarBlendMesh(geometry, mesh) {
  const source = new THREE.MeshBasicMaterial({
      color: 0x00ff00,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    back = source.clone(),
    front = source.clone();
  back.side = THREE.BackSide;
  front.side = THREE.FrontSide;
  for (const pass of [back, front]) {
    pass.polygonOffset = true;
    pass.polygonOffsetFactor = 0;
    pass.polygonOffsetUnits = -8;
  }
  const pair = [back, front],
    result = mesh(geometry(true), pair, [0], [3]);
  result._sideSplitMaterials = pair;
  result._sideSplitBack = back;
  result._sideSplitFront = front;
  result._sideSplitSource = source;
  result._sideSplitPolygonMaterials = pair;
  return result;
}

export function drawCoplanarBlend(renderer, scene, camera, geometry, mesh, base) {
  return renderer.draw(
    [mesh(geometry(), base, [0], [3]), coplanarBlendMesh(geometry, mesh)],
    scene,
    camera,
    false,
    false,
  );
}
