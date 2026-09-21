import * as THREE from 'three';

/** A two-sided BLEND record, drawn back then front; `biased`, it carries a layer offset. */
function coplanarBlendMesh(geometry, mesh, biased) {
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

export function drawCoplanarBlend(renderer, scene, camera, geometry, mesh, base, biased) {
  return renderer.draw(
    [mesh(geometry(), base, [0], [3]), coplanarBlendMesh(geometry, mesh, biased)],
    scene,
    camera,
    false,
    false,
  );
}
