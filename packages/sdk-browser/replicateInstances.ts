import * as THREE from 'three';
import { ENGINE_OWNED } from './hostSceneWatch.ts';
/** Replicate transforms only. Geometry, materials and textures remain shared. */
export function replicateInstances(
  source: THREE.Object3D,
  associations: Map<THREE.Object3D, { meshes?: number; primitives?: number }>,
  count: 1 | 4 | 9 | 12,
  preparedBounds?: THREE.Box3,
) {
  if (![1, 4, 9, 12].includes(count)) throw new Error('Replica count must be 1, 4, 9 or 12');
  source.updateMatrixWorld(true);
  const bounds = preparedBounds ?? new THREE.Box3().setFromObject(source),
    size = bounds.getSize(new THREE.Vector3());
  if (count === 1) return source;
  const [columns, rows] = count === 12 ? [4, 3] : [Math.sqrt(count), Math.sqrt(count)],
    group = new THREE.Group(),
    meshes: THREE.Mesh[] = [];
  source.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) meshes.push(object as THREE.Mesh);
  });
  for (let z = 0; z < rows; z++)
    for (let x = 0; x < columns; x++)
      for (const mesh of meshes) {
        const copy = new THREE.Mesh(mesh.geometry, mesh.material);
        // Cette copie appartient au moteur : l'hôte ne l'a jamais vue et ne peut pas l'écrire.
        // Ce qui relit le graphe à la recherche d'une écriture de l'hôte la saute donc entière.
        copy.userData[ENGINE_OWNED] = true;
        copy.matrixAutoUpdate = false;
        copy.matrix.copy(mesh.matrixWorld);
        copy.matrix.elements[12] += (x - (columns - 1) / 2) * size.x;
        copy.matrix.elements[14] += (z - (rows - 1) / 2) * size.z;
        const association = associations.get(mesh);
        if (association) associations.set(copy, association);
        group.add(copy);
      }
  group.updateMatrixWorld(true);
  return group;
}
