// La scène du témoin Three nu : ses lampes et ce qu'elle tient en mémoire. Servi à la page avec
// `pageThreeNu.mjs`, n'importe que `three`.
import * as THREE from 'three';
import { appliquer, creer } from './pageTemoin.mjs';

const BYTES_PER_TEXEL_WITH_MIPS = 4 * 1.34;

/** La lampe Three du contrat — conversion du témoin (`pageTemoin.mjs`) — plus ce qui est propre au
 *  nu : l'ombre. Le soleil se place hors de la boîte du modèle, sa caméra d'ombre la couvre. */
export function lampe(light, box, shadows) {
  const objet = creer(light);
  appliquer(objet, light, 0);
  objet.castShadow = shadows && light.castsShadow !== false;
  if (light.kind !== 'directional') {
    objet.shadow.mapSize.set(1024, 1024);
    objet.shadow.camera.far = light.range;
    return [objet];
  }
  const rayon = box.getSize(new THREE.Vector3()).length() / 2;
  const centre = box.getCenter(new THREE.Vector3());
  const d = new THREE.Vector3().fromArray(light.direction).normalize();
  objet.position.copy(centre).addScaledVector(d, -rayon * 2);
  objet.target.position.copy(centre);
  const cam = objet.shadow.camera;
  cam.left = cam.bottom = -rayon;
  cam.right = cam.top = rayon;
  cam.near = 0;
  cam.far = rayon * 4;
  cam.updateProjectionMatrix();
  objet.shadow.mapSize.set(4096, 4096);
  objet.shadow.bias = -0.0005;
  return [objet, objet.target];
}

/** Les octets que Three tient pour cette scène : tampons de sommets et d'indices, texels avec mips.
 *  Un tampon partagé par plusieurs géométries (les niveaux de détail) n'est compté qu'une fois. */
export function octets(scene) {
  const geometries = new Set(),
    tampons = new Set(),
    images = new Set();
  scene.traverse((o) => {
    if (o.geometry) geometries.add(o.geometry);
    if (o.material)
      for (const value of Object.values(o.material))
        if (value?.isTexture && value.image) images.add(value.image);
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
