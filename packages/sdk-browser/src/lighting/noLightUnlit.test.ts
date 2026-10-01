// #1016 audit ko: sponza's `ground` and `street` views came out RGB 0 on WebGL2 with no bench light.
// The scene declares none, the contract none either: WebGPU draws the `auto` view's default, the
// unlit albedo (`SceneLightStore.unlit`), but WebGL2 left the source graph lighting, with nothing in
// it, so every surface was black. With no light anywhere, WebGL2 now draws the same unlit view.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSceneLightStore } from '../../../sdk-core/src/index.ts';
import { contractLightingApi, installLighting } from './contractLightingApi.ts';
import { createDrawLists } from '../webgl/cluster/drawLists.ts';
import { Scene } from '../world/core/scene.ts';
import { Light } from '../../../sdk-core/src/world/light/light.ts';
import { Object3D } from '../../../sdk-core/src/world/object/object3d.ts';

/** The kinds of the lights a WebGL2 frame would draw (`drawLists.ts`). */
function drawn(scene: Scene) {
  const lists = createDrawLists(scene, []);
  lists.refresh();
  const kinds = [...lists.lights].map((light) => `${light.kind} ${light.intensity}`);
  lists.dispose();
  return kinds;
}

test('with no light in the scene nor the contract, WebGL2 draws the unlit view, not black', () => {
  const [scene, source, store] = [new Scene(), new Object3D(), createSceneLightStore()];
  const api = contractLightingApi(scene, store, installLighting(scene, 0, source), () => {});
  assert.equal(store.unlit, true, 'WebGPU reads this store as its unlit view');
  assert.deepEqual(drawn(scene), [`ambient ${Math.PI}`], 'an irradiance of π yields albedo');
  assert.equal(api.sceneLit(), false, 'composed by identity, as an unlit view');

  // A light the source graph gains takes the view back: it lights alone, as before #1016.
  source.add(new Light('directional', { intensity: 2 }));
  api.refreshSceneLighting();
  assert.deepEqual(drawn(scene), ['directional 2']);
  assert.equal(api.sceneLit(), true);

  // Its last light gone, the unlit view comes back on the same, unchanged store.
  source.clear();
  api.refreshSceneLighting();
  assert.deepEqual(drawn(scene), [`ambient ${Math.PI}`]);
});
