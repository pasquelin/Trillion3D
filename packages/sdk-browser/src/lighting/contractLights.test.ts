import assert from 'node:assert/strict';
import test from 'node:test';
import { LIGHT_SETTINGS, createSceneLightStore } from '../../../sdk-core/src/index.ts';
import { attachContractLights } from './contractLights.ts';
import { installLighting } from './contractLightingApi.ts';
import { unsupportedClusterLight } from '../webgl/cluster/lights.ts';
import { GraphScene } from '../host/graph/scene.ts';
import { GraphNode } from '../host/graph/node.ts';
import { isLightNode, type GraphAnyLight } from '../host/graph/kinds.ts';
import { GraphLight, GraphLightProbe, type GraphLightKind } from '../host/graph/light.ts';

/** Coordinates of a vector, negative zero brought back to zero: `−0` is not a position. */
const coords = (v: { x: number; y: number; z: number }) => [v.x, v.y, v.z].map((n) => n + 0);
/** A source light of the given kind and strength. */
const light = (kind: GraphLightKind, intensity = 1) =>
  Object.assign(new GraphLight(kind), { intensity });

/** A WebGL2 engine, reduced to what the contract asks of it: its scene and its source graph. */
function harness(sourceLights: GraphNode[] = []) {
  const [scene, source, store] = [new GraphScene(), new GraphNode(), createSceneLightStore()];
  source.add(...sourceLights);
  const contract = attachContractLights(scene, store, installLighting(scene, 0, source), () => {});
  return {
    scene,
    store,
    contract,
    /** Lights the render would see: those a scene walk collects, visible ones only. */
    visibleLights() {
      const found: GraphAnyLight[] = [];
      const walk = (node: GraphNode) => {
        if (!node.visible) return;
        if (isLightNode(node)) found.push(node);
        node.children.forEach(walk);
      };
      walk(scene);
      return found;
    },
  };
}

test('with no light and no requested view, the source graph lights alone and the image does not change', () => {
  const bench = harness([light('directional', 2)]);
  assert.equal(bench.contract.lit, true);
  const lights = bench.visibleLights();
  assert.equal(lights.length, 1);
  assert.equal(lights[0].intensity, 2);
});

test('source auto-lighting preserves and rejects a non-physical point-light decay', () => {
  const point = light('point');
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
  const point = lights[0];
  assert.equal(point.kind, 'point');
  // Radiometric intensity and linear colour taken as-is: no adjustment factor.
  assert.equal(point.intensity, 7);
  assert.deepEqual([point.color.r, point.color.g, point.color.b], [1, 0.5, 0.25]);
  // `decay = 2` and `distance = range`: the program's attenuation is that of the deferred shader.
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
  const ambient = lights[0];
  assert.equal(ambient.kind, 'ambient');
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
  const spot = bench.visibleLights()[0];
  assert.equal(spot.kind, 'spot');
  assert.equal(spot.angle, coneAngle);
  assert.deepEqual(coords(spot.target!.position), [0, 3, 0]);
  const inner = coneAngle * (1 - spot.penumbra!);
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
  const sun = bench.visibleLights()[0];
  assert.equal(sun.kind, 'directional');
  // The program takes the incidence direction as `position − target`: the opposite of the contract.
  assert.deepEqual(coords(sun.position), [0, 1, 0]);
  assert.deepEqual(coords(sun.target!.position), [0, 0, 0]);
  assert.equal(sun.intensity, 4);
});

test('the contract hides the source-graph lights as soon as it governs, and restores them afterwards', () => {
  const bench = harness([light('directional')]);
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
  assert.equal(lights[0].kind, 'point');
  bench.store.remove('lampe');
  bench.contract.apply();
  const back = bench.visibleLights();
  assert.equal(back.length, 1);
  assert.equal(back[0].kind, 'directional');
});

test('changing a light type replaces its light object, leaving no second one', () => {
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
  assert.equal(lights[0].kind, 'spot');
});

test('a visible light probe is read by the cluster renderer, never refused', () => {
  const probe = new GraphLightProbe();
  probe.sh.coefficients[0].set(1, 1, 1);
  assert.equal(unsupportedClusterLight(harness([probe]).scene), undefined);
});
