import test from 'node:test';
import assert from 'node:assert/strict';
import { PASSES, type PassRow } from './passTable.ts';
import { BOUNCE_PROBE_PASS } from '../bounce/probeWgsl.ts';
import { BOUNCE_SURFACE_PASS } from '../bounce/surfaceWgsl.ts';
import { DEFERRED_LIGHTING_PASS } from '../lighting/deferred/deferred.ts';
import { TAA_PASS } from '../taa/shaderWgsl.ts';
import { LIGHT_TILES_PASS } from '../lighting/tiles/tiles.ts';
import { REST_COMPACT_PASS } from '../gpu/raster/restCompact.ts';
import { SHADOW_PASS } from '../gpu/shadow/atlas.ts';
import { SHADOW_LAYER_PASS } from '../gpu/shadow/staticLayer.ts';
import {
  SHADOW_TRANSMITTANCE_CLEAR_PASS,
  SHADOW_TRANSMITTANCE_PASS,
} from '../gpu/shadow/transmittance.ts';
import { LIGHT_CUT_PASS } from '../gpu/dag/encode.ts';
import { SHADOW_PAGE_PASSES } from '../webgpu/shadow/allocPass.ts';
import { MATERIAL_DEPTH_PASS, MATERIAL_SURFACES_PASS } from '../webgpu/core/materialPasses.ts';
import { MATERIAL_TILES_PASS } from '../webgpu/core/materialTiles.ts';
import { PARTICLE_DRAW_PASS, PARTICLES_PASS } from '../particles/webgpuParticleFrame.ts';
import { WATER_COMPOSITE_PASS, WATER_SURFACE_PASS } from '../webgpu/water/passLabels.ts';

/** Each pass's own label constant, and the row the table must give it. */
const ROWS: [string, PassRow][] = [
  [REST_COMPACT_PASS, ['geometry', 'other']],
  [MATERIAL_DEPTH_PASS, ['geometry', 'materials']],
  [MATERIAL_TILES_PASS, ['geometry', 'materials']],
  [MATERIAL_SURFACES_PASS, ['geometry', 'materials']],
  [WATER_SURFACE_PASS, ['transparents', 'other']],
  [WATER_COMPOSITE_PASS, ['transparents', 'other']],
  [PARTICLE_DRAW_PASS, ['transparents', 'other']],
  [SHADOW_PASS, ['shadows', 'other', 'raster']],
  [SHADOW_LAYER_PASS, ['shadows', 'other', 'raster']],
  [SHADOW_TRANSMITTANCE_PASS, ['shadows', 'other', 'raster']],
  [SHADOW_TRANSMITTANCE_CLEAR_PASS, ['shadows', 'other', 'raster']],
  [LIGHT_CUT_PASS, ['shadowCasters', 'other', 'cull']],
  ...SHADOW_PAGE_PASSES.map((name): [string, PassRow] => [name, ['shadows', 'other', 'cull']]),
  [LIGHT_TILES_PASS, ['lightLists', 'other']],
  [BOUNCE_SURFACE_PASS, ['bounce', 'other']],
  [BOUNCE_PROBE_PASS, ['bounce', 'other']],
  [PARTICLES_PASS, ['physics', 'other']],
  [DEFERRED_LIGHTING_PASS, ['lighting', 'other']],
  [TAA_PASS, ['antialiasing', 'other']],
];

test("the table writes each pass's own label, so a renamed pass cannot fall out of its stage", () => {
  for (const [label, row] of ROWS) assert.deepEqual(PASSES[label], row, label);
});
