// LE CONTRAT DE PROFONDEUR DU MOTEUR, vérifié bout à bout.
//
// Avant ce lot, le moteur portait DEUX conventions : la caméra hôte décidait `[−1, 1]` ou `[0, 1]`
// et chaque lecteur de profondeur convertissait. Il n'en porte plus qu'une : la projection est
// composée par le moteur (`perspectiveProjection`), en profondeur INVERSÉE et plan lointain infini
// — proche à 1, infini à 0 —, et `depthConvention.ts` publie ce qui en découle : la comparaison des
// pipelines, la valeur d'effacement, le sens de « plus proche », la conversion en distance.
//
// Ce que ce fichier prouve : la convention de l'hôte n'entre plus dans aucun nombre du moteur ; la
// borne Hi-Z d'une boîte et la profondeur d'un sommet du raster de visibilité sortent bien dans
// cette convention-là ; et un point très lointain garde une profondeur distincte de son voisin,
// là où la projection directe les écrasait.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createEngineCamera, readCameraWorld } from './cameraWorld.ts';
import {
  DEPTH_CLEAR,
  DEPTH_COMPARE,
  DEPTH_NEAR,
  depthDistance,
  depthFromDistance,
  depthNearer,
} from './depthConvention.ts';
import { HIZ_BOUNDS_VALUES, projectCornersInto } from './hizCorners.ts';
import { projectVisibilityVertex } from './visibilityProjection.ts';
import { IDENTITY_ELEMENTS } from './matrixElements.ts';
import { boxCornersInto } from '../sdk-core/index.ts';

const LARGEUR = 800,
  HAUTEUR = 450,
  NEAR = 0.1;

/** Une caméra hôte perspective de pose et d'optique fixées, dans une convention de découpe hôte. */
function camera(coordinateSystem: THREE.CoordinateSystem) {
  const cam = new THREE.PerspectiveCamera(50, LARGEUR / HAUTEUR, NEAR, 1000);
  cam.position.set(2, 1, 8);
  cam.lookAt(0, 0, 0);
  cam.coordinateSystem = coordinateSystem;
  cam.updateProjectionMatrix();
  return readCameraWorld(createEngineCamera(), cam);
}

const webGL = camera(THREE.WebGLCoordinateSystem);
const webGPU = camera(THREE.WebGPUCoordinateSystem);

/** Une boîte monde en face des deux caméras, ni derrière ni coupant le plan proche. */
const CORNERS = new Float64Array(24);
boxCornersInto(CORNERS, 0, -1, -1, -1, 1, 1, 1, IDENTITY_ELEMENTS);

/** La borne Hi-Z d'une caméra du moteur pour cette boîte-là. */
function borne(cam: ReturnType<typeof camera>) {
  const into = new Float64Array(HIZ_BOUNDS_VALUES);
  projectCornersInto(CORNERS, 0, cam.view, cam.viewProjection, cam.near, LARGEUR, HAUTEUR, into, 0);
  assert.equal(into[5], 0, 'la boîte doit être projetée, pas rejetée');
  return into;
}

test('la convention de découpe de l’hôte n’entre plus dans aucun nombre du moteur', () => {
  for (let i = 0; i < 16; i++)
    assert.ok(
      Object.is(webGL.projection[i], webGPU.projection[i]),
      `projection[${i}] : ${webGL.projection[i]} au lieu de ${webGPU.projection[i]}`,
    );
  assert.deepEqual([...borne(webGL)], [...borne(webGPU)], 'mêmes bornes Hi-Z');
});

test('la profondeur du moteur est inversée : le plan proche vaut 1, le lointain 0', () => {
  assert.equal(DEPTH_COMPARE, 'greater');
  assert.equal(DEPTH_NEAR, 1);
  assert.equal(DEPTH_CLEAR, 0);
  assert.equal(depthNearer(DEPTH_NEAR, DEPTH_CLEAR), true);
  assert.equal(depthNearer(DEPTH_CLEAR, DEPTH_NEAR), false);
  assert.equal(depthFromDistance(NEAR, NEAR), 1);
  assert.equal(depthDistance(1, NEAR), NEAR);
  assert.equal(depthDistance(DEPTH_CLEAR, NEAR), Infinity);
});

test('profondeur → distance et distance → profondeur sont réciproques sur le sommet projeté', () => {
  // Un sommet sur l'axe optique de la caméra : sa distance à l'œil est connue de l'appelant.
  const cible: [number, number, number] = [0, 0, 0];
  const position = { getX: () => cible[0], getY: () => cible[1], getZ: () => cible[2] };
  const p = projectVisibilityVertex(
    { elements: IDENTITY_ELEMENTS },
    position,
    0,
    webGL,
    LARGEUR,
    HAUTEUR,
  );
  assert.ok(p, 'le sommet doit se projeter');
  assert.ok(p!.z > 0 && p!.z < 1, `profondeur ${p!.z} hors de la plage du moteur`);
  const distance = depthDistance(p!.z, NEAR);
  assert.ok(
    Math.abs(depthFromDistance(distance, NEAR) - p!.z) < 1e-12,
    'la conversion aller-retour doit rendre la même profondeur',
  );
});

test('à 10⁶ unités, deux sommets voisins gardent des profondeurs distinctes en simple précision', () => {
  const lointain = (distance: number) => {
    const position = { getX: () => 0, getY: () => 0, getZ: () => 8 - distance };
    const p = projectVisibilityVertex(
      { elements: IDENTITY_ELEMENTS },
      position,
      0,
      webGL,
      LARGEUR,
      HAUTEUR,
    );
    assert.ok(p, 'le sommet lointain doit se projeter');
    return Math.fround(p!.z);
  };
  const proche = lointain(1e6),
    plusLoin = lointain(1e6 + 1);
  assert.notEqual(proche, plusLoin, `10⁶ et 10⁶+1 rendent la même profondeur ${proche}`);
  assert.equal(depthNearer(proche, plusLoin), true);
});
