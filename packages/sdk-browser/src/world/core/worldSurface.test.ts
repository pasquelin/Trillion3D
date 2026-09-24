import test from 'node:test';
import * as G from '../../host/graph/graph.fixture.ts';
import assert from 'node:assert/strict';
import { material } from '../../../../sdk-core/src/world/material/index.ts';
import { Texture } from '../../../../sdk-core/src/world/texture/texture.ts';
import { followHostTexture, importHostTexture } from '../../host/textureImport.ts';
import type { HostAttributes, HostTexture } from '../../host/resources.ts';
import { hostSurface, repaintHostSurface } from './worldSurface.ts';
import { clusterMaterialReason } from '../../host/surfaceGate.ts';
import { importHostSurface } from '../../host/surfaceImport.ts';

// #335: a repainted entry writes its values into the surface the session already holds, and the
// version bump is what the page rows reread it on (`page/surface.ts`).
test('a repaint writes the values hostSurface writes, and bumps the surface version', () => {
  for (const kind of ['meshStandard', 'meshLambert'] as const) {
    const paint = material[kind]({ color: 0x3c8ce0, emissive: 0x000000 });
    const surface = hostSurface(paint, false, new Map()) as unknown as Record<string, unknown>;
    const version = surface.version as number;
    paint.color.set(0xff0000);
    paint.emissive.set(0x00ff00);
    paint.emissiveIntensity = 2;
    repaintHostSurface(surface as never, paint);
    const fresh = hostSurface(paint, false, new Map()) as unknown as Record<string, unknown>;
    for (const field of ['color', 'emissive'])
      assert.deepEqual(
        (surface[field] as { toArray(): number[] }).toArray(),
        (fresh[field] as { toArray(): number[] }).toArray(),
        `${kind} ${field}`,
      );
    assert.ok((surface.version as number) > version, `${kind}: the version moved`);
  }
});

// #360, #361: each counter of a map writes its own part of the host texture the surface already
// holds, in place: a sampling or a placement its fields, read by the import at the next image, a
// version the picture, sent again.
const repainted = (map: Texture) => {
  const paint = material.meshStandard({ color: 0x808080, map });
  const surface = hostSurface(paint, false, new Map()) as unknown as Record<string, unknown>;
  const host = surface.map as HostTexture & { version: number };
  return { paint, surface, host, record: importHostTexture(host), version: host.version };
};

test('a repaint writes a map’s sampling and placement in place, nothing sent again', () => {
  const map = new Texture({ width: 2, height: 2 });
  const { paint, surface, host, record, version } = repainted(map);
  const { sampling, placement } = record;
  map.wrap = 'repeat';
  map.repeat.set(4, 4);
  map.rotation = Math.PI / 6;
  map.magFilter = 'nearest';
  map.minFilter = 'nearestMipNearest';
  map.anisotropy = 8;
  repaintHostSurface(surface as never, paint);
  assert.equal(host.version, version, 'no picture sent again');
  assert.equal(surface.map, host, 'the same host texture, written in place');
  followHostTexture(record);
  assert.equal(importHostTexture(host), record, 'the same engine record');
  assert.deepEqual(
    [record.wrapS, record.magFilter, record.minFilter, record.anisotropy],
    ['repeat', 'nearest', 'nearest-mip-nearest', 8],
  );
  assert.deepEqual([record.sampling, record.placement], [sampling + 1, placement + 1]);
  const [a, b, , c] = Array.from(record.transform);
  assert.ok(Math.abs(a - 4 * Math.cos(Math.PI / 6)) < 1e-9, 'repeat and rotation composed');
  assert.ok(Math.abs(b + 4 * Math.sin(Math.PI / 6)) < 1e-9);
  assert.ok(Math.abs(c - 4 * Math.sin(Math.PI / 6)) < 1e-9);
});

test('a repaint sends a map’s picture again at every version, with its values', () => {
  for (const change of [
    (map: Texture) => (map.image = { width: 4, height: 4 }),
    (map: Texture) => (map.flipY = false),
    (map: Texture) => (map.colorSpace = 'linear'),
    (map: Texture) => (
      ((map.image as { data: Uint8Array }).data[0] = 255),
      (map.needsUpdate = true)
    ),
  ]) {
    const map = new Texture({ data: new Uint8Array(16), width: 2, height: 2 });
    const { paint, surface, host, version } = repainted(map);
    const surfaceVersion = surface.version as number;
    change(map);
    paint.color.set(0xff0000);
    repaintHostSurface(surface as never, paint);
    assert.ok(host.version > version, `${change}: sent again`);
    assert.equal(host.image, map.image, 'the picture the texture shows');
    assert.ok((surface.version as number) > surfaceVersion, 'the values written');
    assert.equal((surface.color as G.Color).getHex(), 0xff0000);
  }
});

// #360, #361: a placement and the pixels moved together — an atlas frame drawn and slid in the
// same tick — take both writes: the picture sent again, and the placement composed.
test('a repaint that moves a map’s placement and its pixels together takes both', () => {
  const map = new Texture({ data: new Uint8Array(16), width: 2, height: 2 });
  const { paint, surface, host, record, version } = repainted(map);
  const sent = record.version;
  (map.image as { data: Uint8Array }).data[0] = 255;
  map.needsUpdate = true;
  map.offset.set(0.5, 0);
  repaintHostSurface(surface as never, paint);
  assert.ok(host.version > version, 'the pixels sent again');
  followHostTexture(record);
  assert.equal(record.version, sent + 1, 'the record refilled, its picture to send again');
  assert.equal(record.transform[6], 0.5, 'the offset reaches the record');
});

// #337: a world's glass reaches the WebGL2 program as the transmissive copy it draws over the
// frozen backdrop (`page/selection/collect.ts` routes a surface that transmits there), its volume
// intact, and is never admitted as a paged cluster, which cannot read the backdrop.
test('a glass wears a physical surface the WebGL2 program draws as a transmissive copy', () => {
  const glass = material.meshPhysical({ roughness: 0.02, transmission: 1, ior: 1.4, thickness: 1 });
  const surface = hostSurface(glass, false, new Map());
  assert.equal(surface.family, 'physical');
  const attributes = {
    position: new G.GraphAttribute(new Float32Array(9), 3),
    normal: new G.GraphAttribute(new Float32Array(9), 3),
  } as unknown as HostAttributes;
  assert.equal(clusterMaterialReason(surface, attributes, true), undefined);
  assert.match(String(clusterMaterialReason(surface, attributes)), /scene copy/);
  const record = importHostSurface(surface)!;
  assert.deepEqual(
    [record.transmission, record.ior, record.thickness, record.lit],
    [1, 1.4, 1, true],
  );
});
