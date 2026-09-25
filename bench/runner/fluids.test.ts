import test from 'node:test';
import assert from 'node:assert/strict';
import { OCEAN } from '../../packages/sdk-core/src/fluids/waves.fixture.ts';
import { fluidsScene } from './fluids.ts';
import { limitsLines, limitsOf } from './limits.ts';
import { FLUIDS_SCENE, applySceneFlag, sceneNote, sceneOf } from './scene.ts';

test('the fluids scene holds one ocean, 100 bodies, 20 fires and 5 smoke volumes', () => {
  const scene = fluidsScene();
  assert.equal(scene.water.waves, OCEAN, 'the eight-wave ocean of the physics fixture');
  const counts = [scene.bodies.length, scene.fires.length, scene.smokes.length];
  assert.deepEqual(counts, [100, 20, 5]);
  const kinds = new Map<string, number>();
  for (const { shape } of scene.bodies) kinds.set(shape.type, (kinds.get(shape.type) ?? 0) + 1);
  // `floatingBodies`: every tenth a plank, a raft (compound) and a cork ball; cubes otherwise.
  assert.deepEqual(Object.fromEntries(kinds), { box: 80, compound: 10, sphere: 10 });
});

test('the fluids scene is named by the bench and reads no cache', () => {
  assert.match(sceneNote(FLUIDS_SCENE) ?? '', /stand-ins/);
  const flags = new Map([['scene', FLUIDS_SCENE]]);
  applySceneFlag(flags, '/nowhere');
  assert.equal(flags.has('cache-apres'), false);
  assert.equal(sceneOf(undefined, FLUIDS_SCENE), FLUIDS_SCENE);
});

test('the report reads the shape the probe returns', () => {
  const probe = limitsOf(
    { extensions: ['EXT_color_buffer_float', 'EXT_disjoint_timer_query_webgl2'] },
    {
      features: new Set(['timestamp-query']),
      adapter: { maxBindGroups: 4, maxStorageBufferBindingSize: 4294967292 },
      defaults: { maxBindGroups: 4, maxStorageBufferBindingSize: 134217728 },
    },
  );
  assert.deepEqual(probe.webgl2, { halfFloatColor: false, floatColor: true, timerQuery: true });
  assert.equal(probe.webgpu?.timestampQuery, true);
  const lines = limitsLines(probe);
  assert.ok(lines.includes('- WebGPU: timestamp-query yes, 1 of 2 limits above the default'));
  assert.ok(lines.includes('| maxStorageBufferBindingSize | 134217728 | 4294967292 |'));
  assert.ok(
    lines.includes(
      '- WebGL2: half-float colour no, float colour yes, EXT_disjoint_timer_query_webgl2 yes',
    ),
  );
  const refused = limitsOf(null, {
    features: new Set(),
    adapter: { maxBindGroups: 8 },
    defaults: {},
  });
  assert.ok(
    limitsLines(refused).includes('- WebGPU: timestamp-query no, 0 of 1 limits above the default'),
  );
  assert.equal(limitsLines({ failed: 'lost' })[2], 'Probe failed: lost', 'a failed probe is said');
  const none = limitsLines(limitsOf(null, null));
  assert.ok(none.includes('- WebGL2: unavailable') && none.includes('- WebGPU: unavailable'));
});
