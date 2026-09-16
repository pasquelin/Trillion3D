// Défaut 10 : sous une transformation de déterminant négatif, le rasteriseur CPU du tampon de
// visibilité gardait la face que tous les autres chemins éliminent — les pipelines WebGPU par le
// `frontFace` que `windingCw` inverse, Three en WebGL par `frontFaceCW = determinant() < 0`, son
// propre ombrage (`visibilityLighting`) par le signe de `face`. Il dessinait donc exactement les
// faces que le rejet par cône supprime, ce qui a été lu comme un défaut du cône.
//
// Deux triangles de sens opposés, posés dans le plan z = 0 et séparés à l'écran : la réflexion
// `scale(1,1,-1)` les laisse au même endroit et ne change que l'orientation. La face montrée doit
// alors basculer de l'un à l'autre, pour un matériau de face comme de dos.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { rasterVisibility } from './visibilityRaster.ts';
import { unpackVisibilityId, type VisPage } from './visibilityTypes.ts';
import { matrixWindingCw } from './webgpuPagesWinding.ts';

const VUE: [number, number] = [96, 96];
// Gauche : sens direct. Droite : sens inverse. Même aire, même hauteur, pas de recouvrement.
const POSITIONS = [-2, -1, 0, -0.5, -1, 0, -1.25, 1, 0, 0.5, -1, 0, 1.25, 1, 0, 2, -1, 0];

function page(matrix: THREE.Matrix4, side: THREE.Side): VisPage {
  const geometrie = new THREE.BufferGeometry();
  geometrie.setAttribute('position', new THREE.Float32BufferAttribute(POSITIONS, 3));
  return {
    array: new Uint32Array([0, 1, 2, 3, 4, 5]),
    attributes: geometrie.attributes,
    matrix,
    material: new THREE.MeshBasicMaterial({ side }),
  };
}

function camera() {
  const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  cam.position.set(0, 0, 5);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld(true);
  return cam;
}

/** Les triangles réellement écrits dans le tampon, et combien de pixels chacun couvre. */
function trianglesDessines(matrix: THREE.Matrix4, side: THREE.Side) {
  const { ids } = rasterVisibility([page(matrix, side)], camera(), VUE);
  const pixels = new Map<number, number>();
  for (const identifiant of ids) {
    const lu = unpackVisibilityId(identifiant);
    if (lu) pixels.set(lu.triangleIndex, (pixels.get(lu.triangleIndex) ?? 0) + 1);
  }
  return pixels;
}

const DIRECTE = new THREE.Matrix4();
const REFLEXION = new THREE.Matrix4().makeScale(1, 1, -1);

test('la réflexion est bien celle que le moteur reconnaît, la transformation directe non', () => {
  assert.equal(matrixWindingCw(DIRECTE.elements), false);
  assert.equal(matrixWindingCw(REFLEXION.elements), true);
});

test('sans réflexion, la face montrée est celle d’avant le lot : le triangle 0 de face', () => {
  const face = trianglesDessines(DIRECTE, THREE.FrontSide);
  assert.deepEqual([...face.keys()], [0], 'matériau de face : seul le triangle direct est écrit');
  assert.ok((face.get(0) ?? 0) > 100, `couverture attendue, vu ${face.get(0)}`);
  const dos = trianglesDessines(DIRECTE, THREE.BackSide);
  assert.deepEqual([...dos.keys()], [1], 'matériau de dos : seul le triangle inverse est écrit');
});

test('sous réflexion, la face éliminée est l’autre, comme pour les pipelines WebGPU', () => {
  const face = trianglesDessines(REFLEXION, THREE.FrontSide);
  assert.deepEqual(
    [...face.keys()],
    [1],
    'la réflexion échange la face montrée ; sans cela le cône supprimait ce que le CPU dessinait',
  );
  const dos = trianglesDessines(REFLEXION, THREE.BackSide);
  assert.deepEqual([...dos.keys()], [0], 'et elle l’échange aussi pour un matériau de dos');
});

test('la réflexion ne change que le choix de la face, jamais la couverture', () => {
  const directe = trianglesDessines(DIRECTE, THREE.FrontSide);
  const reflechie = trianglesDessines(REFLEXION, THREE.FrontSide);
  assert.equal(
    directe.get(0),
    reflechie.get(1),
    'les deux triangles se superposent à l’écran : même nombre de pixels de part et d’autre',
  );
});

test('un matériau double face ignore la réflexion et garde les deux triangles', () => {
  for (const matrix of [DIRECTE, REFLEXION])
    assert.deepEqual(
      [...trianglesDessines(matrix, THREE.DoubleSide).keys()].sort(),
      [0, 1],
      'aucune face n’est éliminée, avec ou sans réflexion',
    );
});
