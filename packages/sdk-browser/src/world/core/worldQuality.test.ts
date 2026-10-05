import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  QUALITY_LEVELS,
  QUALITY_PRESETS,
  type QualityLevels,
} from '../../../../sdk-core/src/runtime/qualityLevels.ts';
import { QUALITY_GROUPS } from '../../../../sdk-core/src/runtime/renderSettings.ts';
import { renderScaleBounds, type RenderScale } from '../../frame/renderScaleOption.ts';
import { createWorldQuality, renderScaleOf, type WorldQualityOptions } from './worldQuality.ts';
import { createWorldSettings } from './worldSettings.ts';

const WORLD_SETTINGS = createWorldSettings().table;

/** The engine's table, with the shadows' and the view distance's levels written as a level of
 *  S35 would: the mechanism is proven on values it can see. */
const LEVELS: QualityLevels = {
  ...QUALITY_LEVELS,
  shadows: { smooth: { sunRays: 2 }, balanced: { sunRays: 4 }, fine: { sunRays: 8 }, max: {} },
  viewDistance: {
    smooth: { pixelError: 8 },
    balanced: { pixelError: 4 },
    fine: { pixelError: 1 },
    max: {},
  },
};

function quality(options?: WorldQualityOptions, asked: RenderScale = 'auto') {
  const settings = createWorldSettings();
  const frame = {
    last: null as { renderWidth: number | null; renderHeight: number | null } | null,
  };
  const scale = {
    asked: () => asked,
    ask: (next: RenderScale) => void (asked = next),
    drawn: () => frame.last,
  };
  return { settings, frame, quality: createWorldQuality(settings, scale, options, LEVELS) };
}

test('by default the preset reads max and every setting resolves to its default', () => {
  const { settings, quality: q } = quality();
  assert.equal(q.preset, 'max');
  for (const name of Object.keys(WORLD_SETTINGS) as (keyof typeof WORLD_SETTINGS)[])
    assert.equal(settings.get(name), WORLD_SETTINGS[name].default, name);
  assert.deepEqual(q.resolution, { mode: 'native', dynamic: true }, "R0's 'auto', 50 to 100 %");
});

test('a group the page set holds through every preset change', () => {
  const { settings, quality: q } = quality();
  q.preset = 'balanced';
  assert.equal(settings.get('sunRays'), 4);
  q.set('shadows', 'fine');
  q.preset = 'smooth';
  assert.equal(q.get('shadows'), 'fine');
  assert.equal(settings.get('sunRays'), 8, 'the page level, over the preset');
  assert.equal(settings.get('pixelError'), 8, 'the other groups follow the preset');
  assert.equal(q.preset, 'custom');
  q.set('shadows', 'preset');
  assert.equal(q.get('shadows'), 'smooth');
  assert.equal(settings.get('sunRays'), 2, 'given back, the group follows the preset');
  assert.equal(q.preset, 'smooth');
});

test('a page level of max writes the defaults over a coarser preset', () => {
  const { settings, quality: q } = quality({ preset: 'smooth', groups: { shadows: 'max' } });
  assert.equal(settings.get('sunRays'), WORLD_SETTINGS.sunRays.default);
  assert.equal(settings.get('pixelError'), 8);
  q.preset = 'max';
  assert.equal(q.preset, 'max', 'the page level is the preset level: not custom');
});

test('a value the page set by hand is not overwritten by a preset', () => {
  const { settings, quality: q } = quality();
  settings.set('pixelError', 2, 'page');
  q.preset = 'smooth';
  assert.equal(settings.get('pixelError'), 2);
  assert.equal(settings.source('pixelError'), 'page');
});

test('the resolution goes through the render scale: a mode fixed, or dynamic below it', () => {
  const { quality: q } = quality();
  q.resolution = { mode: 'fast' };
  assert.deepEqual(renderScaleBounds(renderScaleOf({ mode: 'fast' })), {
    auto: false,
    min: 0.5,
    max: 0.5,
  });
  assert.deepEqual(q.resolution, { mode: 'fast', dynamic: false });
  q.resolution = { mode: 'native', dynamic: true };
  assert.equal(renderScaleOf(q.resolution), 'auto', 'the engine’s own dynamic resolution');
  q.resolution = { mode: 'fast', dynamic: true };
  assert.deepEqual(renderScaleOf(q.resolution), { min: 0.25, max: 0.5 });
  q.resolution = { mode: 'native', scale: 0.8 };
  assert.deepEqual(q.resolution, { mode: 'native', scale: 0.8, dynamic: false });
  assert.throws(() => (q.resolution = { mode: 'ultra' as never }), /QUALITY_RESOLUTION/);
});

test('levels() lists every group and level with the values they resolve to', () => {
  const { quality: q } = quality();
  const table = q.levels();
  assert.deepEqual(table.presets, ['smooth', 'balanced', 'fine', 'max']);
  assert.equal(table.groups.shadows.fine.sunRays, 8);
  assert.equal(table.groups.shadows.max.sunRays, WORLD_SETTINGS.sunRays.default);
  assert.equal(table.groups.indirectLight.max.bounce, false);
  assert.equal('shadowNormalBias' in table.groups.shadows.max, false, "the editor's own");
  assert.equal(table.resolution.fast, 0.5);
});

test('an unknown preset, group or level is refused by name', () => {
  const { quality: q } = quality();
  assert.throws(() => (q.preset = 'ultra' as never), /QUALITY_PRESET/);
  assert.throws(() => q.set('sound' as never, 'max'), /QUALITY_GROUP/);
  assert.throws(() => q.set('shadows', 'ultra' as never), /QUALITY_LEVEL/);
});

test('every level writes settings of its own group that a preset may write, within bounds', () => {
  const settings = createWorldSettings();
  for (const group of QUALITY_GROUPS)
    for (const level of QUALITY_PRESETS)
      for (const [name, value] of Object.entries(QUALITY_LEVELS[group][level])) {
        const entry = WORLD_SETTINGS[name as keyof typeof WORLD_SETTINGS];
        assert.equal(entry?.group, group, `${group}.${level}: ${name}`);
        settings.set(name as keyof typeof WORLD_SETTINGS, value as never, 'quality');
      }
  for (const group of QUALITY_GROUPS)
    assert.deepEqual(QUALITY_LEVELS[group].max, {}, `${group}: max is today's defaults`);
});

test('renderSize is the size the last frame says it was drawn at, none before one', () => {
  const { frame, quality: q } = quality();
  assert.equal(q.renderSize, null);
  frame.last = { renderWidth: null, renderHeight: null };
  assert.equal(q.renderSize, null, 'an engine that does not say it');
  frame.last = { renderWidth: 1728, renderHeight: 1112 };
  assert.deepEqual(q.renderSize, { width: 1728, height: 1112 });
});
