import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LOD_QUALITY } from '../../../../sdk-core/src/lod/policy.ts';
import { LIGHT_SETTINGS } from '../../../../sdk-core/src/scene/light/contracts.ts';
import { MAX_ANISOTROPY } from '../../texture/maxAnisotropy.ts';
import * as vsm from '../../vsm/constants.ts';
import { createWorldSettings } from './worldSettings.ts';

const WORLD_SETTINGS = createWorldSettings().table;

/** Each setting and the value the engine reads today in its place. */
const TODAY: Record<keyof typeof WORLD_SETTINGS, boolean | number> = {
  pixelError: LOD_QUALITY.source.pixelError,
  antialiasing: true, // `WorldOptions.temporalAntialiasing`'s default
  bounce: false, // `world.bounce`'s default
  dynamicShadows: true,
  glass: true,
  particles: true,
  reflections: true,
  postProcessing: true,
  maxAnisotropy: MAX_ANISOTROPY,
  shadowPages: vsm.VSM_POOL_PAGES,
  shadowCache: vsm.VSM_CACHE_ON === 1,
  sunReceiverMask: vsm.VSM_COVER_SUN,
  lampReceiverMask: vsm.VSM_COVER_LOCAL,
  sunRays: vsm.VSM_TRACE_RAYS_SUN,
  sunSamplesPerRay: vsm.VSM_TRACE_STEPS_SUN,
  lampRays: vsm.VSM_TRACE_RAYS_LOCAL,
  lampSamplesPerRay: vsm.VSM_TRACE_STEPS_LOCAL,
  sunResolutionBias: vsm.VSM_SUN_LEVEL_BIAS,
  sunResolutionBiasMoving: vsm.VSM_SUN_LEVEL_BIAS_MOVING,
  lampResolutionBias: vsm.VSM_LOCAL_LEVEL_BIAS,
  lampResolutionBiasMoving: vsm.VSM_LOCAL_LEVEL_BIAS_MOVING,
  shadowNormalBias: vsm.VSM_NORMAL_BIAS,
  sunTexelDither: vsm.VSM_TRACE_DITHER_SUN,
  lampTexelDither: vsm.VSM_TRACE_DITHER_LOCAL,
  sunExtrapolateSlope: vsm.VSM_TRACE_SLOPE_CAP_SUN,
  lampExtrapolateSlope: vsm.VSM_TRACE_SLOPE_CAP_LOCAL,
  translucentShadowFilter: LIGHT_SETTINGS.translucentShadowFilter,
};

test('every default is the constant the engine reads today, and a fresh registry resolves it', () => {
  const settings = createWorldSettings();
  assert.deepEqual(Object.keys(WORLD_SETTINGS).sort(), Object.keys(TODAY).sort());
  for (const [name, value] of Object.entries(TODAY)) {
    const key = name as keyof typeof WORLD_SETTINGS;
    assert.equal(WORLD_SETTINGS[key].default, value, name);
    assert.equal(settings.get(key), value, name);
  }
});

test('every default lies within its own bounds', () => {
  for (const [name, entry] of Object.entries(WORLD_SETTINGS)) {
    if (entry.kind === 'flag') assert.equal(typeof entry.default, 'boolean', name);
    else if (entry.kind === 'enum') assert.ok(entry.values.includes(entry.default), name);
    else
      assert.ok(entry.default >= entry.range[0] && entry.default <= entry.range[1], `${name} out`);
  }
});

test('only the pages, the cache, the receiver masks and the dynamic shadows drop the cache', () => {
  const dropping = Object.entries(WORLD_SETTINGS)
    .filter(([, entry]) => entry.invalidates === 'shadowCache')
    .map(([name]) => name)
    .sort();
  assert.deepEqual(dropping, [
    'dynamicShadows',
    'lampReceiverMask',
    'shadowCache',
    'shadowPages',
    'sunReceiverMask',
  ]);
});

test('a ray count holds in a shadow mask lane: 1 to 15 rays a light, never more', () => {
  const settings = createWorldSettings();
  for (const name of ['sunRays', 'lampRays'] as const) {
    assert.deepEqual(WORLD_SETTINGS[name].range, [1, 15], name);
    settings.set(name, 15, 'page');
    assert.equal(settings.get(name), 15, name);
    assert.throws(() => settings.set(name, 16, 'page'), /RENDER_SETTING_VALUE/, name);
  }
});
