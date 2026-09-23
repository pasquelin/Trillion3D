// Scene of the bare Three witness: its lights and what it holds in memory. Served to the page with
// `pageThreeNu.ts`, imports only `three`.
import * as THREE from 'three';
import { appliquer, creer } from './pageTemoin.ts';
import type { ThreeLight } from './pageTemoin.ts';
import type { SceneLight } from '../../packages/sdk-core/src/scene/light/contracts.ts';

const BYTES_PER_TEXEL_WITH_MIPS = 4 * 1.34;

/** The contract's Three light — conversion from the witness (`pageTemoin.ts`) — plus what is
 *  specific to the bare path: the shadow. The sun sits outside the model box, its shadow camera covers it. */
export function lampe(
  light: SceneLight,
  box: THREE.Box3,
  shadows: boolean,
): [ThreeLight] | [ThreeLight, THREE.Object3D] {
  const objet = creer(light);
  appliquer(objet, light, 0);
  objet.castShadow = shadows && light.castsShadow !== false;
  if (light.kind !== 'directional') {
    const punctual = objet as THREE.SpotLight | THREE.PointLight;
    punctual.shadow.mapSize.set(1024, 1024);
    punctual.shadow.camera.far = light.range ?? 0;
    return [punctual];
  }
  const directionnelle = objet as THREE.DirectionalLight;
  const rayon = box.getSize(new THREE.Vector3()).length() / 2;
  const centre = box.getCenter(new THREE.Vector3());
  const d = new THREE.Vector3().fromArray(light.direction ?? [0, -1, 0]).normalize();
  directionnelle.position.copy(centre).addScaledVector(d, -rayon * 2);
  directionnelle.target.position.copy(centre);
  const cam = directionnelle.shadow.camera;
  cam.left = cam.bottom = -rayon;
  cam.right = cam.top = rayon;
  cam.near = 0;
  cam.far = rayon * 4;
  cam.updateProjectionMatrix();
  directionnelle.shadow.mapSize.set(4096, 4096);
  directionnelle.shadow.bias = -0.0005;
  return [directionnelle, directionnelle.target];
}

/** Bytes Three holds for this scene: vertex and index buffers, texels with mips.
 *  A buffer shared by several geometries (levels of detail) is counted only once. */
export function octets(scene: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(),
    tampons = new Set<THREE.BufferAttribute | THREE.InterleavedBufferAttribute>(),
    images = new Set<{ width?: number; height?: number }>();
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    if (mesh.material)
      for (const value of Object.values(mesh.material as object)) {
        const texture = value as {
          isTexture?: boolean;
          image?: { width?: number; height?: number };
        };
        if (texture?.isTexture && texture.image) images.add(texture.image);
      }
  });
  let geometrie = 0,
    textures = 0;
  for (const g of geometries) {
    for (const a of Object.values(g.attributes)) tampons.add(a);
    if (g.index) tampons.add(g.index);
  }
  for (const a of tampons) geometrie += a.array.byteLength;
  for (const i of images) textures += (i.width ?? 0) * (i.height ?? 0) * BYTES_PER_TEXEL_WITH_MIPS;
  return { geometrie, textures, geometries: geometries.size };
}
