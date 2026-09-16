// Reproduction GEO-03 (WebGL) : copies de lampes figées quand l'image tenue masque le rafraîchissement
// de `sceneLighting.ts`. Doit être inversé après correction.
//
// `exactPagesRender.ts:102` (et `autonomousRender.ts` par le même mécanisme via `gate.updateWorlds`)
// ne relit les lampes de la scène source que si `worldsMoved` est vrai :
//
//   const worldsMoved = gate.updateWorlds(source);
//   if (worldsMoved) sceneLights.update();
//
// `WebglFrameGate.updateWorlds` (webglFrameGate.ts) ne renvoie vrai qu'une fois par changement de
// `revisions.scene`, et cette révision n'est incrémentée que par un appel explicite à
// `gate.sceneChanged()` (`bumpScene`). Muter une propriété THREE (intensité, position) directement
// sur la lampe source, sans passer par l'API hôte qui appelle `refreshSceneLights`/`sceneChanged`,
// ne bouge donc jamais `revisions.scene` : la copie ne se resynchronise jamais, qu'elle soit ou non
// l'image tenue. Ce fichier pilote directement les modules réels (`installSceneLighting`,
// `sceneLightingApi`, `createWebglFrameGate`), sans backend WebGL complet : c'est le harnais le plus
// simple qui exerce fidèlement le même appel que `exactPagesRender.ts` et `autonomousRender.ts`.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { installSceneLighting, sceneLightingApi } from './sceneLighting.ts';
import { createWebglFrameGate } from './webglFrameGate.ts';

function pointLightCopy(scene: THREE.Scene) {
  return scene.children.find(
    (object) => (object as THREE.Light).isLight,
  ) as THREE.PointLight | undefined;
}

/** Une image fixe telle que `exactPagesRender.ts` la déroule : porte gardée, lampes relues seulement
 *  si `worldsMoved`, sans jamais appeler `gate.sceneChanged()` elle-même (ce que ferait l'hôte via
 *  `refreshSceneLights` sur un vrai changement déclaré). */
function renderFixedFrame(
  gate: ReturnType<typeof createWebglFrameGate>,
  source: THREE.Object3D,
  sceneLights: ReturnType<typeof installSceneLighting>,
) {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 0, 5);
  camera.updateMatrixWorld();
  gate.viewChanged(camera, [64, 64], 1);
  const frameHeld = gate.held();
  if (frameHeld) return { frameHeld, worldsMoved: false };
  const worldsMoved = gate.updateWorlds(source);
  if (worldsMoved) sceneLights.update();
  gate.keep(1, 3, 0, 0, 1, false);
  return { frameHeld, worldsMoved };
}

test('GEO-03 repro : trois images stables puis mutation de la lampe sans refreshSceneLighting (défaut)', () => {
  const source = new THREE.Group();
  const light = new THREE.PointLight(0xffffff, 1, 0);
  light.position.set(0, 0, 0);
  source.add(light);
  const renderScene = new THREE.Scene();
  const lighting = installSceneLighting(renderScene, source, 0);
  const gate = createWebglFrameGate();
  const api = sceneLightingApi(lighting, gate.sceneChanged);

  // Trois images fixes, même caméra : la troisième doit être tenue.
  const results = [1, 2, 3].map(() => renderFixedFrame(gate, source, lighting));
  assert.deepEqual(
    results.map((r) => r.frameHeld),
    [false, false, true],
    'la deuxième image identique arme la tenue, la troisième est tenue',
  );

  const copyBefore = pointLightCopy(renderScene)!;
  assert.equal(copyBefore.intensity, 1);
  assert.equal(copyBefore.position.x, 0);

  // Mutation directe de la source, hors API hôte : aucun bumpScene n'est déclenché.
  light.intensity = 7;
  light.position.x = 9;

  const frame4 = renderFixedFrame(gate, source, lighting);
  assert.equal(frame4.frameHeld, true, "l'image reste tenue : rien n'a bougé du point de vue des révisions");

  const copyAfter = pointLightCopy(renderScene)!;
  assert.equal(copyAfter.intensity, 1, 'DÉFAUT : la copie garde l’ancienne intensité');
  assert.equal(copyAfter.position.x, 0, 'DÉFAUT : la copie garde l’ancienne position');
});

test('GEO-03 repro : une seule image avant mutation (pas encore stable) — la copie ne se resynchronise pas non plus', () => {
  const source = new THREE.Group();
  const light = new THREE.PointLight(0xffffff, 1, 0);
  light.position.set(0, 0, 0);
  source.add(light);
  const renderScene = new THREE.Scene();
  const lighting = installSceneLighting(renderScene, source, 0);
  const gate = createWebglFrameGate();
  const api = sceneLightingApi(lighting, gate.sceneChanged);

  // Une seule image : le témoin de tenue n'est pas encore stable.
  const first = renderFixedFrame(gate, source, lighting);
  assert.equal(first.frameHeld, false);
  assert.equal(first.worldsMoved, true, 'premier rendu : la révision de scène initiale est neuve');

  light.intensity = 7;
  light.position.x = 9;

  const second = renderFixedFrame(gate, source, lighting);
  assert.equal(
    second.frameHeld,
    false,
    "l'image tenue n'explique pas tout : celle-ci n'est pas tenue",
  );
  assert.equal(
    second.worldsMoved,
    false,
    'la cause réelle : `updateWorlds` ne redevient vrai que sur `bumpScene`, jamais sur une mutation directe',
  );
  const copy = pointLightCopy(renderScene)!;
  assert.equal(copy.intensity, 1, 'DÉFAUT reproduit même hors image tenue : worldsMoved est en cause');
  assert.equal(copy.position.x, 0, 'DÉFAUT reproduit même hors image tenue : worldsMoved est en cause');
});

test('GEO-03 : refreshSceneLighting() relit correctement les valeurs (contournement)', () => {
  const source = new THREE.Group();
  const light = new THREE.PointLight(0xffffff, 1, 0);
  light.position.set(0, 0, 0);
  source.add(light);
  const renderScene = new THREE.Scene();
  const lighting = installSceneLighting(renderScene, source, 0);
  const gate = createWebglFrameGate();
  const api = sceneLightingApi(lighting, gate.sceneChanged);

  for (let i = 0; i < 3; i++) renderFixedFrame(gate, source, lighting);
  light.intensity = 7;
  light.position.x = 9;
  renderFixedFrame(gate, source, lighting); // toujours tenue, toujours périmée (voir test précédent)

  api.refreshSceneLighting();
  const copy = pointLightCopy(renderScene)!;
  assert.equal(copy.intensity, 7, 'refreshSceneLighting relit immédiatement la valeur actuelle');
  assert.equal(copy.position.x, 9, 'refreshSceneLighting relit immédiatement la position actuelle');

  // Et la tenue a bien été cassée par sceneChanged() : l'image suivante n'est plus « tenue ».
  const next = renderFixedFrame(gate, source, lighting);
  assert.equal(next.frameHeld, false, 'refreshSceneLighting invalide la tenue via bumpScene');
});
