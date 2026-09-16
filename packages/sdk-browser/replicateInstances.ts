import * as THREE from 'three';
import { MATRIX_VALUES, boxIsEmpty, multiplyMatrix4 } from '../sdk-core/index.ts';
import type { MultiplyLot } from './mathBatchRuntime.ts';
import { ENGINE_OWNED } from './hostSceneWatch.ts';
import { hostWorldBounds } from './hostWorldBounds.ts';
import { resolveHostSubtree } from './hostWorldMatrices.ts';
import { copyElements } from './matrixElements.ts';

/**
 * Les trois tampons possédés de la réplication : la pose du groupe, la pose posée d'une copie et
 * leur produit. Le socle ne lit et n'écrit que des `Float64Array` (`mathMatrix4.ts`) ; les matrices
 * de la bibliothèque hôte sont des tableaux ordinaires, recopiés à l'entrée et à la sortie.
 */
const groupWorld = new Float64Array(16),
  placed = new Float64Array(16),
  product = new Float64Array(16);

/** Replicate transforms only. Geometry, materials and textures remain shared. */
export function replicateInstances(
  source: THREE.Object3D,
  associations: Map<THREE.Object3D, { meshes?: number; primitives?: number }>,
  count: 1 | 4 | 9 | 12,
  /** Bornes monde à plat `[minX, minY, minZ, maxX, maxY, maxZ]`, quand l'appelant les a déjà. */
  preparedBounds?: ArrayLike<number>,
  /** Le tampon des produits, quand l'appelant l'a réservé à la taille exacte des copies. */
  lot?: MultiplyLot | null,
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
  // Les produits partent EN LOT par le gouverneur quand le tampon porte exactement une copie par
  // place, et que ses vues désignent encore la mémoire du module. Sinon chaque produit se fait sur
  // place, par le même `multiplyMatrix4` et sur les mêmes entrées : les mêmes bits.
  const enLot = lot?.holds(rows * columns * meshes.length) ? lot : null;
  const copies: THREE.Mesh[] = [];
  // La pose monde du groupe ne bouge pas d'une copie à l'autre : elle est recopiée une seule fois.
  copyElements(groupWorld, group.matrixWorld.elements);
  for (let z = 0; z < rows; z++)
    for (let x = 0; x < columns; x++)
      for (const mesh of meshes) {
        const copy = new THREE.Mesh(mesh.geometry, mesh.material);
        // Cette copie appartient au moteur : l'hôte ne l'a jamais vue et ne peut pas l'écrire.
        // Ce qui relit le graphe à la recherche d'une écriture de l'hôte la saute donc entière.
        copy.userData[ENGINE_OWNED] = true;
        copy.matrixAutoUpdate = false;
        copyElements(placed, mesh.matrixWorld.elements);
        placed[12] += (x - (columns - 1) / 2) * sizeX;
        placed[14] += (z - (rows - 1) / 2) * sizeZ;
        copyElements(copy.matrix.elements, placed);
        // Le groupe et ses copies appartiennent au moteur : la matrice monde d'une copie est le
        // produit de celle du groupe par sa matrice posée, celui-là même que la référence calculait
        // en remontant le groupe entier. Le socle l'écrit, terme à terme, sans seconde passe.
        if (enLot) {
          const at = copies.length * MATRIX_VALUES;
          enLot.a.set(groupWorld, at);
          enLot.b.set(placed, at);
          copies.push(copy);
        } else
          copyElements(copy.matrixWorld.elements, multiplyMatrix4(product, groupWorld, placed));
        const association = associations.get(mesh);
        if (association) associations.set(copy, association);
        group.add(copy);
      }
  if (!enLot) return group;
  enLot.run();
  for (let i = 0; i < copies.length; i++) {
    const world = copies[i].matrixWorld.elements,
      at = i * MATRIX_VALUES;
    for (let k = 0; k < MATRIX_VALUES; k++) world[k] = enLot.out[at + k];
  }
  return group;
}
