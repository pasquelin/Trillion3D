import * as THREE from 'three';
import { boxIsEmpty, multiplyMatrix4 } from '../sdk-core/index.ts';
import { ENGINE_OWNED } from './hostSceneWatch.ts';
import { hostWorldBounds } from './hostWorldBounds.ts';
import { resolveHostSubtree } from './hostWorldMatrices.ts';

/** Replicate transforms only. Geometry, materials and textures remain shared. */
export function replicateInstances(
  source: THREE.Object3D,
  associations: Map<THREE.Object3D, { meshes?: number; primitives?: number }>,
  count: 1 | 4 | 9 | 12,
  /** Bornes monde à plat `[minX, minY, minZ, maxX, maxY, maxZ]`, quand l'appelant les a déjà. */
  preparedBounds?: ArrayLike<number>,
) {
  if (![1, 4, 9, 12].includes(count)) throw new Error('Replica count must be 1, 4, 9 or 12');
  resolveHostSubtree(source);
  if (count === 1) return source;
  const bounds = preparedBounds ?? hostWorldBounds(source),
    // Une boîte vide n'a pas de taille : elle rend zéro sur chaque axe, comme la référence.
    empty = boxIsEmpty(bounds, 0),
    sizeX = empty ? 0 : bounds[3] - bounds[0],
    sizeZ = empty ? 0 : bounds[5] - bounds[2];
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
        const placed = copy.matrix.elements,
          world = mesh.matrixWorld.elements;
        for (let i = 0; i < 16; i++) placed[i] = world[i];
        placed[12] += (x - (columns - 1) / 2) * sizeX;
        placed[14] += (z - (rows - 1) / 2) * sizeZ;
        // Le groupe et ses copies appartiennent au moteur : la matrice monde d'une copie est le
        // produit de celle du groupe par sa matrice posée, celui-là même que la référence calculait
        // en remontant le groupe entier. Le socle l'écrit, terme à terme, sans seconde passe.
        multiplyMatrix4(copy.matrixWorld.elements, group.matrixWorld.elements, placed);
        const association = associations.get(mesh);
        if (association) associations.set(copy, association);
        group.add(copy);
      }
  return group;
}
