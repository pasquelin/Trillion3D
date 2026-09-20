import * as THREE from 'three';

function coplanarBlendMesh(geometry, mesh, biased) {
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
  const pair = [back, front],
    result = mesh(geometry(true), pair, [0], [3]);
  result._sideSplitMaterials = pair;
  result._sideSplitBack = back;
  result._sideSplitFront = front;
  result._sideSplitSource = source;
  result._sideSplitPolygonMaterials = biased ? pair : undefined;
  return result;
}

export function drawCoplanarBlend(renderer, scene, camera, geometry, mesh, base, biased) {
  return renderer.draw(
    [mesh(geometry(), base, [0], [3]), coplanarBlendMesh(geometry, mesh, biased)],
    scene,
    camera,
    false,
    false,
  );
}
