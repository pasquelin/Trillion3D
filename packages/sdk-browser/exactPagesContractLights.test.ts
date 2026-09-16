import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { LIGHT_SETTINGS, createSceneLightStore } from '../sdk-core/index.ts';
import { attachContractLights } from './exactPagesContractLights.ts';
import { installSceneLighting } from './sceneLighting.ts';

/** Les coordonnées d'un vecteur, le zéro négatif ramené à zéro : `−0` n'est pas une position. */
const coords = (vector: THREE.Vector3) => vector.toArray().map((value) => value + 0);

/** Un moteur rendu par Three, réduit à ce que le contrat lui demande : sa scène et son graphe source. */
function harness(sourceLights: THREE.Light[] = []) {
  const scene = new THREE.Scene();
  const source = new THREE.Object3D();
  for (const light of sourceLights) source.add(light);
  const store = createSceneLightStore();
  const installed = installSceneLighting(scene, source, 0x000000);
  const contract = attachContractLights(scene, store, installed, () => {});
  return {
    scene,
    store,
    contract,
    /** Les lampes que le rendu verrait : celles qu'un parcours de la scène collecte, visibles seules. */
    visibleLights() {
      const found: THREE.Light[] = [];
      scene.traverseVisible((object) => {
        if ((object as THREE.Light).isLight) found.push(object as THREE.Light);
      });
      return found;
    },
  };
}

test("sans lampe ni vue demandée, le graphe source éclaire seul et l'image ne change pas", () => {
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  const bench = harness([sun]);
  assert.equal(bench.contract.lit, true);
  const lights = bench.visibleLights();
  assert.equal(lights.length, 1);
  assert.equal((lights[0] as THREE.DirectionalLight).intensity, 2);
});

test('une ponctuelle du contrat éclaire, et son retrait rend la vue éclairée noire', () => {
  const bench = harness();
  bench.store.add({
    id: 'lampe',
    kind: 'point',
    position: [1, 2, 3],
    range: 10,
    color: [1, 0.5, 0.25],
    intensity: 7,
    castsShadow: false,
  });
  bench.contract.apply();
  const lights = bench.visibleLights();
  assert.equal(lights.length, 1);
  const point = lights[0] as THREE.PointLight;
  assert.ok(point.isPointLight);
  // Intensité radiométrique et couleur linéaire reprises telles quelles : aucun facteur d'ajustement.
  assert.equal(point.intensity, 7);
  assert.deepEqual([point.color.r, point.color.g, point.color.b], [1, 0.5, 0.25]);
  // `decay = 2` et `distance = range` : l'atténuation de Three est celle du shader différé.
  assert.equal(point.decay, 2);
  assert.equal(point.distance, 10);
  assert.deepEqual(coords(point.position), [1, 2, 3]);
  assert.equal(bench.contract.lit, true);

  bench.store.setView('lit');
  bench.store.remove('lampe');
  bench.contract.apply();
  // Vue éclairée sans aucune lampe : rien n'éclaire, et rien ne prétend éclairer.
  assert.equal(bench.visibleLights().length, 0);
  assert.equal(bench.contract.lit, true);
});

test("la vue `unlit` rend l'albédo par une irradiance de π, sans aucune lampe du contrat", () => {
  const bench = harness();
  bench.store.add({
    id: 'lampe',
    kind: 'point',
    position: [0, 0, 0],
    range: 5,
    color: [1, 1, 1],
    intensity: 3,
    castsShadow: false,
  });
  bench.store.setView('unlit');
  bench.contract.apply();
  const lights = bench.visibleLights();
  assert.equal(lights.length, 1);
  const ambient = lights[0] as THREE.AmbientLight;
  assert.ok(ambient.isAmbientLight);
  assert.equal(ambient.intensity, Math.PI);
  assert.equal(bench.contract.lit, false);
});

test('un projecteur reprend son cône, et sa pénombre égale le bord adouci du contrat', () => {
  const bench = harness();
  const coneAngle = 0.6;
  bench.store.add({
    id: 'projecteur',
    kind: 'spot',
    position: [0, 4, 0],
    direction: [0, -1, 0],
    coneAngle,
    range: 12,
    color: [1, 1, 1],
    intensity: 5,
    castsShadow: false,
  });
  bench.contract.apply();
  const spot = bench.visibleLights()[0] as THREE.SpotLight;
  assert.ok(spot.isSpotLight);
  assert.equal(spot.angle, coneAngle);
  assert.deepEqual(coords(spot.target.position), [0, 3, 0]);
  const inner = coneAngle * (1 - spot.penumbra);
  assert.ok(
    Math.abs(Math.cos(inner) - (Math.cos(coneAngle) + LIGHT_SETTINGS.spotEdgeSoftness)) < 1e-9,
  );
});

test('une directionnelle prend sa direction de propagation, jamais une position inventée', () => {
  const bench = harness();
  bench.store.add({
    id: 'soleil',
    kind: 'directional',
    direction: [0, -1, 0],
    color: [1, 1, 1],
    intensity: 4,
    castsShadow: false,
  });
  bench.contract.apply();
  const sun = bench.visibleLights()[0] as THREE.DirectionalLight;
  assert.ok(sun.isDirectionalLight);
  // Three prend la direction d'incidence par `position − cible` : elle vaut l'opposé du contrat.
  assert.deepEqual(coords(sun.position), [0, 1, 0]);
  assert.deepEqual(coords(sun.target.position), [0, 0, 0]);
  assert.equal(sun.intensity, 4);
});

test('le contrat efface les lampes du graphe source dès qu il gouverne, et les rend ensuite', () => {
  const sun = new THREE.DirectionalLight(0xffffff, 1);
  const bench = harness([sun]);
  bench.store.add({
    id: 'lampe',
    kind: 'point',
    position: [0, 0, 0],
    range: 4,
    color: [1, 1, 1],
    intensity: 1,
    castsShadow: false,
  });
  bench.contract.apply();
  const lights = bench.visibleLights();
  assert.equal(lights.length, 1);
  assert.ok((lights[0] as THREE.PointLight).isPointLight);
  bench.store.remove('lampe');
  bench.contract.apply();
  const back = bench.visibleLights();
  assert.equal(back.length, 1);
  assert.ok((back[0] as THREE.DirectionalLight).isDirectionalLight);
});

test('changer le type d une lampe remplace son objet Three, sans en laisser deux', () => {
  const bench = harness();
  bench.store.add({
    id: 'lampe',
    kind: 'point',
    position: [0, 1, 0],
    range: 6,
    color: [1, 1, 1],
    intensity: 2,
    castsShadow: false,
  });
  bench.contract.apply();
  bench.store.set('lampe', { kind: 'spot', direction: [0, -1, 0], coneAngle: 0.4 });
  bench.contract.apply();
  const lights = bench.visibleLights();
  assert.equal(lights.length, 1);
  assert.ok((lights[0] as THREE.SpotLight).isSpotLight);
});
