import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../host/graph/graph.fixture.ts';
import { surfaceOf } from '../page/surface.ts';
import { rowMaterial } from '../webgpu/row/pageRowMaterial.ts';
import { FLAG_FOG_FREE } from '../visibility/types.ts';
import { FOG_FREE_MODEL_BIT, MODEL_SHIFT } from '../scene/surfaceModel.ts';
import { BLEND_ITEM_WORDS, writeBlendItemRecord } from '../webgpu/blend/items.ts';
import { BLEND_SHADER } from '../webgpu/blend/shader.ts';
import { SHADE_SHADER } from '../visibility/shader/shadeWgsl.ts';
import { DIRECT_LIGHTING_SHADER } from './deferred/shaders.ts';
import { prepared, device } from '../webgpu/water/pass.fixture.ts';
import { writeVolumeRecords } from '../webgpu/transparent/transmission.ts';
import { WATER_COMPOSITE_SHADER } from '../webgpu/water/compositeWgsl.ts';
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts';

test('a fog-free material reaches both the opaque flag and transparent shader', () => {
  const material = new G.GraphSurface('standard', { fog: false });
  const surface = surfaceOf(material);
  assert.equal(surface.fog, false);
  const layers = { mapLayer: new Map(), dataLayer: new Map() };
  const row = rowMaterial(surface, undefined, layers);
  assert.equal(row.flags & FLAG_FOG_FREE, FLAG_FOG_FREE);
  assert.match(SHADE_SHADER, new RegExp(`page.flags&${FLAG_FOG_FREE}u`));
  assert.match(DIRECT_LIGHTING_SHADER, /surfaceFlag&128u/);

  const floats = new Float32Array(BLEND_ITEM_WORDS);
  const ints = new Uint32Array(floats.buffer);
  writeBlendItemRecord(
    floats,
    ints,
    0,
    {
      surface,
      matrix: new G.Matrix4(),
      flags: 1,
      count: 3,
      sourceGeometry: new G.Geometry(),
      orderKey: 0,
      orderRank: 0,
    },
    layers,
  );
  assert.equal(floats[39], FOG_FREE_MODEL_BIT);
  assert.match(BLEND_SHADER, new RegExp(`flags&${FOG_FREE_MODEL_BIT << MODEL_SHIFT}u`));
  material.fog = true;
  assert.equal(surfaceOf(material).fog, true, 'an in-place material change is heard');
  assert.equal(rowMaterial(surface, undefined, layers).flags & FLAG_FOG_FREE, 0);
});

test('a fog-free transmissive material reaches the water composite without changing opacity', () => {
  const { blendState, gpu } = prepared();
  const item = blendState.blendGpu.find((entry) => entry.transmissive);
  assert.ok(item);
  item.surface.fog = false;
  const rt = { gpu, blendState } as unknown as WebgpuPagesRuntime;
  writeVolumeRecords(rt, device);
  assert.equal(blendState.volumePacked[7], 1);
  assert.match(WATER_COMPOSITE_SHADER, /vol.attenuationColor.w!=0.0/);
  item.surface.fog = true;
  writeVolumeRecords(rt, device);
  assert.equal(blendState.volumePacked[7], 0);
});
