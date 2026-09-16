// LE REPÈRE DE RENDU, ET CE QU'IL DOIT À LA FOIS CHANGER ET NE PAS CHANGER.
//
// Une scène loin de l'origine du monde tremblait : `vue · monde` se composait en simple précision,
// où deux nombres de l'ordre de 50 km qui s'annulent presque ne laissent que quelques millimètres
// de chiffres justes, et l'annulation ne tombait pas au même endroit d'une image à l'autre. Le
// processeur retire maintenant la position de l'œil en double précision, avant tout arrondi.
//
// Ces preuves tiennent en deux phrases. LOIN : la même scène, posée à l'origine puis à 50 km, envoie
// exactement les mêmes nombres. À L'ORIGINE : là où l'œil est déjà au zéro du monde, rien ne change
// d'un bit — c'est ce qui garantit que les images déjà rendues gardent leurs pixels.
//
// Les coordonnées sont des multiples de 1/8 et le décalage vaut 50 000 : leurs sommes sont exactes
// en double, si bien que l'égalité attendue est celle du recentrage et non celle d'un arrondi
// complaisant.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { multiplyMatrix4, worldToRenderOrigin } from '../sdk-core/index.ts';
import { cameraSelectionUniforms } from './gpuSelection.ts';
import { sameRenderOrigin } from './cameraRenderOrigin.ts';
import { cameraMoteur } from './cameraFixture.ts';
import { createEngineCamera, holdCameraWorld, readCameraWorld } from './cameraWorld.ts';

const DECALAGE: [number, number, number] = [50000, 50000, 50000];
/** Pose de la primitive, de l'œil et de sa cible, en multiples de 1/8. */
const POSE: [number, number, number] = [3.25, -1.5, 2.125],
  OEIL: [number, number, number] = [-2.75, 1.875, 9.5],
  CIBLE: [number, number, number] = [0.5, -0.25, 0.75];

/** Égalité nombre à nombre. `===` plutôt qu'une comparaison profonde : deux zéros de signes
 *  opposés sont le même nombre, et rien dans une matrice ne les distingue. */
function memesNombres(obtenu: ArrayLike<number>, attendu: ArrayLike<number>, quoi: string) {
  assert.equal(obtenu.length, attendu.length, `${quoi} : longueurs`);
  for (let i = 0; i < attendu.length; i++)
    assert.ok(obtenu[i] === attendu[i], `${quoi}, terme ${i} : ${obtenu[i]} ≠ ${attendu[i]}`);
}

/** Ce qu'une image envoie au noyau de coupe pour une scène décalée de `offset` : les seize nombres
 *  simple précision d'une matrice monde ramenée à l'œil, et les uniformes de la caméra. */
function envoi(offset: readonly [number, number, number]) {
  const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.5, 1000);
  camera.position.set(OEIL[0] + offset[0], OEIL[1] + offset[1], OEIL[2] + offset[2]);
  camera.lookAt(CIBLE[0] + offset[0], CIBLE[1] + offset[1], CIBLE[2] + offset[2]);
  camera.updateMatrixWorld(true);
  const cam = cameraMoteur(camera);
  const world = new THREE.Matrix4()
    .makeRotationY(0.7)
    .setPosition(POSE[0] + offset[0], POSE[1] + offset[1], POSE[2] + offset[2]);
  const worlds = new Float32Array(16);
  worldToRenderOrigin(worlds, world.elements, cam.eye);
  return { cam, world, worlds, uniforms: cameraSelectionUniforms(cam, 1, [1280, 720]) };
}

test('même scène à l’origine et à 50 km : les matrices envoyées sont identiques bit à bit', () => {
  const proche = envoi([0, 0, 0]),
    loin = envoi(DECALAGE);
  memesNombres(loin.worlds, proche.worlds, 'matrice monde ramenée à l’œil');
  memesNombres(loin.uniforms.view, proche.uniforms.view, 'vue relative');
  memesNombres(loin.uniforms.planes, proche.uniforms.planes, 'plans relatifs');
  assert.equal(loin.uniforms.cameraStretch, proche.uniforms.cameraStretch);
});

test('l’origine du repère publiée est la position monde de l’œil, pas un zéro', () => {
  const loin = envoi(DECALAGE);
  memesNombres(
    loin.uniforms.cameraWorld,
    [OEIL[0] + DECALAGE[0], OEIL[1] + DECALAGE[1], OEIL[2] + DECALAGE[2]],
    'origine du repère de rendu',
  );
});

test('caméra à l’origine du monde : rien ne change d’un bit', () => {
  const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.5, 1000);
  camera.lookAt(CIBLE[0], CIBLE[1], CIBLE[2]);
  camera.updateMatrixWorld(true);
  const cam = cameraMoteur(camera);
  memesNombres(cam.eye, [0, 0, 0], 'l’œil est au zéro du monde');
  memesNombres(cam.viewRelative, cam.view, 'la vue relative EST la vue');
  memesNombres(cam.planesRelative, cam.planes, 'les plans relatifs SONT les plans');
  const world = new THREE.Matrix4().makeRotationZ(-0.4).setPosition(POSE[0], POSE[1], POSE[2]);
  const ramene = worldToRenderOrigin(new Float64Array(16), world.elements, cam.eye);
  memesNombres(ramene, world.elements, 'la matrice monde est rendue telle quelle');
});

test('vue relative × monde relatif rend la composition absolue, là où f32 renonce', () => {
  const loin = envoi(DECALAGE);
  const attendu = multiplyMatrix4(new Float64Array(16), loin.cam.view, loin.world.elements);
  const relatif = worldToRenderOrigin(new Float64Array(16), loin.world.elements, loin.cam.eye);
  const obtenu = multiplyMatrix4(new Float64Array(16), loin.cam.viewRelative, relatif);
  for (let i = 0; i < 16; i++)
    assert.ok(
      Math.abs(obtenu[i]! - attendu[i]!) <= 1e-9,
      `terme ${i} : ${obtenu[i]} ≠ ${attendu[i]} — la composition a changé de résultat`,
    );
});

test('une vue tenue garde son repère de rendu : holdCameraWorld le recopie aussi', () => {
  const source = envoi(DECALAGE).cam,
    gelee = holdCameraWorld(createEngineCamera(), source);
  memesNombres(gelee.viewRelative, source.viewRelative, 'vue relative tenue');
  memesNombres(gelee.viewProjectionRelative, source.viewProjectionRelative, 'vue-projection');
  memesNombres(gelee.planesRelative, source.planesRelative, 'plans relatifs tenus');
  // La source est réécrite par l'image suivante : la copie tenue décrit toujours la sienne.
  const avant = [...gelee.viewRelative];
  const tournee = new THREE.PerspectiveCamera(55, 16 / 9, 0.5, 1000);
  tournee.lookAt(1, 2, 3);
  tournee.updateMatrixWorld(true);
  readCameraWorld(source, tournee);
  assert.notDeepEqual([...source.viewRelative], avant, 'témoin : la source a bien changé');
  memesNombres(gelee.viewRelative, avant, 'la copie tenue n’a pas bougé');
});

test('une origine jamais posée est différente de tout : la première image rebase', () => {
  const jamais = new Float64Array([NaN, NaN, NaN]);
  assert.equal(sameRenderOrigin(jamais, [0, 0, 0]), false);
  assert.equal(sameRenderOrigin(jamais, jamais), false);
  assert.equal(sameRenderOrigin([1, 2, 3], [1, 2, 3]), true);
  assert.equal(sameRenderOrigin([1, 2, 3], [1, 2, 3.0001]), false);
});
