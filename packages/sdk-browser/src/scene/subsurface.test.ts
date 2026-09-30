import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../host/graph/graph.fixture.ts';
import { importHostSurface } from '../host/surfaceImport.ts';
import { createSurfaceBuffer } from './surfaceBuffer.ts';
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts';
import { DIRECT_LIGHTING_WGSL } from '../lighting/direct/lightingWgsl.ts';
import { shaderFunctions } from '../texture/shaderRule.fixture.ts';
import { hostSide } from './materialSide.ts';
import { material } from '../../../sdk-core/src/world/material/index.ts';
import { Texture } from '../../../sdk-core/src/world/texture/texture.ts';
import { hostSurface, repaintHostSurface } from '../world/core/worldSurface.ts';
import { eachMap, SUBSURFACE_UNIT } from '../webgl/cluster/materialMaps.ts';
import { rowMaterial } from '../webgpu/row/pageRowMaterial.ts';

test('thin transmission stays independent of albedo, disabled by default and on single sides', () => {
  const material = G.standardSurface();
  assert.deepEqual(importHostSurface(material)?.subsurfaceColor, [0, 0, 0]);
  Object.assign(material, {
    side: hostSide('double'),
    subsurfaceColor: new G.Color().setRGB(0.2, 0.7, 0.1),
  });
  const surface = importHostSurface(material)!;
  assert.deepEqual(surface.subsurfaceColor, [0.2, 0.7, 0.1]);
  Object.assign(material, { color: new G.Color().setRGB(1, 0, 0) });
  assert.deepEqual(importHostSurface(material)?.subsurfaceColor, [0.2, 0.7, 0.1]);
  material.side = hostSide('front');
  assert.deepEqual(importHostSurface(material)?.subsurfaceColor, [0, 0, 0]);
});

test('a transmission map enters the existing color atlas and keeps its own slot', () => {
  const image = G.dataTexture(new Uint8Array([20, 100, 40, 255]), 1, 1);
  const material = G.standardSurface();
  Object.assign(material, { side: hostSide('double'), subsurfaceMap: image });
  const surface = importHostSurface(material)!;
  assert.ok(surface.subsurfaceMap);
  const row = rowMaterial(surface, undefined, {
    mapLayer: new Map([[surface.subsurfaceMap, 7]]),
    dataLayer: new Map(),
  });
  assert.equal(row.subsurface, 7);
  assert.equal(row.map, 0, 'transmission does not replace the base map');
});

test('enabled transmission allocates exactly eight bytes per pixel, without another MRT', () => {
  const gpu = fakeDevice({ limits: { maxTextureDimension2D: 4096 } });
  const disabled = createSurfaceBuffer(gpu.device, 13, 7);
  const enabled = createSurfaceBuffer(gpu.device, 13, 7, true);
  assert.equal(enabled.allocationBytes - disabled.allocationBytes, (13 * 7 - 1) * 8);
  assert.equal(enabled.views().length, 4);
  assert.equal(enabled.subsurface.width, 13);
  assert.equal(enabled.subsurface.height, 7);
  disabled.dispose();
  enabled.dispose();
  // Five textures each, the receiver-offset target gone (#1410).
  assert.equal(gpu.destroyed.length, 10);
});

test('shipped thin diffuse transmission integrates to its color, dark front and shadow included', () => {
  const { thinTransmission } = shaderFunctions<{
    thinTransmission: (cosine: number, energy: number) => number;
  }>(DIRECT_LIGHTING_WGSL, ['thinTransmission']);
  assert.equal(thinTransmission(0.5, 8), 0);
  assert.equal(thinTransmission(-0.5, 0), 0);
  assert.ok(Math.abs(thinTransmission(-0.5, 8) - 4 / Math.PI) < 1e-6);
  let integral = 0;
  for (let i = 0; i < 1024; i++)
    integral += (thinTransmission(-(i + 0.5) / 1024, 1) * 2 * Math.PI) / 1024;
  assert.ok(Math.abs(integral - 1) < 1e-6);
});

test('public material reaches both backends, and a color edit repaints without an API rebuild', () => {
  const map = new Texture({ width: 1, height: 1 });
  const paint = material.meshStandard({
    side: 'double',
    subsurfaceColor: 0x00ff00,
    subsurfaceMap: map,
  });
  const surface = hostSurface(paint, false, new Map());
  assert.deepEqual(importHostSurface(surface)?.subsurfaceColor, [0, 1, 0]);
  assert.ok(importHostSurface(surface)?.subsurfaceMap);
  const version = paint.version;
  paint.subsurfaceColor.set(0xff0000);
  assert.ok(paint.version > version);
  repaintHostSurface(surface, paint);
  assert.deepEqual(importHostSurface(surface)?.subsurfaceColor, [1, 0, 0]);
  const units: number[] = [];
  eachMap(surface, (unit, image) => {
    if (image) units.push(unit);
  });
  assert.deepEqual(units, [SUBSURFACE_UNIT], 'GL binds the same independent texture');
});
