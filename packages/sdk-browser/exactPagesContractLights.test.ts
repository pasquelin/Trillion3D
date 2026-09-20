import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { LIGHT_SETTINGS, createSceneLightStore } from '../sdk-core/index.ts';
import { attachContractLights } from './exactPagesContractLights.ts';
import { installSceneLighting } from './sceneLighting.ts';
import { unsupportedClusterLight } from './webglClusterLights.ts';

/** Coordinates of a vector, negative zero brought back to zero: `−0` is not a position. */
const coords = (vector: THREE.Vector3) => vector.toArray().map((value) => value + 0);

/** A Three-rendered engine, reduced to what the contract asks of it: its scene and its source graph. */
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
    /** Lights the render would see: those a scene walk collects, visible ones only. */
    visibleLights() {
      const found: THREE.Light[] = [];
      scene.traverseVisible((object) => {
        if ((object as THREE.Light).isLight) found.push(object as THREE.Light);
      });
      return found;
    },
  };
}

test('with no light and no requested view, the source graph lights alone and the image does not change', () => {
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  const bench = harness([sun]);
  assert.equal(bench.contract.lit, true);
  const lights = bench.visibleLights();
  assert.equal(lights.length, 1);
  assert.equal((lights[0] as THREE.DirectionalLight).intensity, 2);
});

test('source auto-lighting preserves and rejects a non-physical point-light decay', () => {
  const point = new THREE.PointLight();
  point.decay = 1;
  const bench = harness([point]);
  assert.match(unsupportedClusterLight(bench.scene)!, /decay 1 is unsupported/);
});

test('a contract point light lights, and removing it makes the lit view black', () => {
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
  // Radiometric intensity and linear colour taken as-is: no adjustment factor.
  assert.equal(point.intensity, 7);
  assert.deepEqual([point.color.r, point.color.g, point.color.b], [1, 0.5, 0.25]);
  // `decay = 2` and `distance = range`: Three's attenuation is that of the deferred shader.
  assert.equal(point.decay, 2);
  assert.equal(point.distance, 10);
  assert.deepEqual(coords(point.position), [1, 2, 3]);
  assert.equal(bench.contract.lit, true);

  bench.store.setView('lit');
  bench.store.remove('lampe');
  bench.contract.apply();
  // Lit view with no light at all: nothing lights, and nothing claims to light.
  assert.equal(bench.visibleLights().length, 0);
  assert.equal(bench.contract.lit, true);
});

test('the `unlit` view yields albedo by an irradiance of π, with no contract light', () => {
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

test('a spotlight takes back its cone, and its penumbra equals the contract softened edge', () => {
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

test('a directional takes its propagation direction, never an invented position', () => {
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
  // Three takes the incidence direction as `position − target`: it equals the opposite of the contract.
  assert.deepEqual(coords(sun.position), [0, 1, 0]);
  assert.deepEqual(coords(sun.target.position), [0, 0, 0]);
  assert.equal(sun.intensity, 4);
});

test('the contract hides the source-graph lights as soon as it governs, and restores them afterwards', () => {
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

test('changing a light type replaces its Three object, leaving no second one', () => {
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
