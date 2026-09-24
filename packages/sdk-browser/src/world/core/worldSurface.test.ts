import test from 'node:test';
import * as THREE from 'three';
import assert from 'node:assert/strict';
import { material } from '../../../../sdk-core/src/world/material/index.ts';
import { Texture } from '../../../../sdk-core/src/world/texture/texture.ts';
import { followHostTexture, importHostTexture } from '../../host/surfaceImport.ts';
import type { HostTexture } from '../../host/resources.ts';
import { hostSurface, repaintHostSurface } from './worldSurface.ts';

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

// #360, #361: a map's placement and filters written after the surface was built reach the host
// texture already held, whose version bump refills the engine record in place; a repaint that
// moved a colour only uploads nothing again.
test('a repaint writes a map’s sampling into the host texture it already holds', () => {
  const map = new Texture({ width: 2, height: 2 });
  const paint = material.meshStandard({ color: 0x808080, map });
  const surface = hostSurface(paint, false, new Map()) as unknown as Record<string, unknown>;
  const host = surface.map as HostTexture & { version: number };
  const record = importHostTexture(host);
  const version = host.version;
  paint.color.set(0xff0000);
  repaintHostSurface(surface as never, paint);
  assert.equal(host.version, version, 'a colour alone leaves the texture as it was');
  map.wrap = 'repeat';
  map.repeat.set(4, 4);
  map.rotation = Math.PI / 6;
  map.magFilter = 'nearest';
  map.minFilter = 'nearestMipNearest';
  map.anisotropy = 8;
  repaintHostSurface(surface as never, paint);
  assert.ok(host.version > version, 'the texture version moved');
  assert.equal(surface.map, host, 'the same host texture, written in place');
  followHostTexture(record);
  assert.equal(importHostTexture(host), record, 'the same engine record, refilled');
  assert.deepEqual(
    [record.wrapS, record.magFilter, record.minFilter, record.anisotropy],
    ['repeat', 'nearest', 'nearest-mip-nearest', 8],
  );
  const [a, b, , c] = record.transform;
  assert.ok(Math.abs(a - 4 * Math.cos(Math.PI / 6)) < 1e-9, 'repeat and rotation composed');
  assert.ok(Math.abs(b + 4 * Math.sin(Math.PI / 6)) < 1e-9);
  assert.ok(Math.abs(c - 4 * Math.sin(Math.PI / 6)) < 1e-9);
});

// #360: a placement alone — repeat, offset, rotation — moves the texture's placement counter, not
// its version: it is the host texture's UV matrix, recomposed once per image and aliased by its
// engine record, and it uploads nothing again, where a bumped version would reload the whole
// image on WebGL2 at every frame of an animated UV.
test('a repaint that moves a map’s placement alone recomposes its matrix, no upload', () => {
  const map = new Texture({ width: 2, height: 2 });
  const paint = material.meshStandard({ map });
  const surface = hostSurface(paint, false, new Map()) as unknown as Record<string, unknown>;
  const host = surface.map as HostTexture & { version: number };
  const record = importHostTexture(host);
  const version = host.version;
  const textureVersion = map.version,
    placement = map.placement;
  map.offset.set(0.25, 0.5);
  map.rotation = Math.PI / 2;
  assert.equal(map.version, textureVersion, 'the placement counts apart from the version');
  assert.equal(map.placement, placement + 2, 'the offset, then the rotation');
  repaintHostSurface(surface as never, paint);
  assert.equal(host.version, version, 'no new upload');
  followHostTexture(record);
  assert.equal(importHostTexture(host), record);
  const [a, , , , , , tx, ty] = record.transform;
  assert.ok(Math.abs(a) < 1e-9, 'the quarter turn reaches the record');
  assert.ok(tx !== 0 || ty !== 0, 'the offset reaches the record');
});

// #360: nothing tells pixels written in place under the same image from a sampler change, so
// every version a map moved to — other than its placement alone — sends its picture again, with
// its sampling, into the host texture the surface holds; the values are written beside it.
test('a repaint sends a map’s picture again at every version but a placement', () => {
  for (const change of [
    (map: Texture) => (map.image = { width: 4, height: 4 }),
    (map: Texture) => (map.flipY = false),
    (map: Texture) => (map.colorSpace = 'linear'),
    (map: Texture) => (map.channel = 1),
    (map: Texture) => (
      ((map.image as { data: Uint8Array }).data[0] = 255),
      (map.needsUpdate = true)
    ),
    (map: Texture) => (map.magFilter = 'nearest'),
  ]) {
    const map = new Texture({ data: new Uint8Array(16), width: 2, height: 2 });
    const paint = material.meshStandard({ color: 0x808080, map });
    const surface = hostSurface(paint, false, new Map()) as unknown as Record<string, unknown>;
    const host = surface.map as HostTexture & { version: number };
    const version = host.version,
      surfaceVersion = surface.version as number;
    change(map);
    paint.color.set(0xff0000);
    repaintHostSurface(surface as never, paint);
    assert.ok(host.version > version, `${change}: sent again`);
    assert.equal(host.image, map.image, 'the picture the texture shows');
    assert.equal(
      host.magFilter,
      THREE[map.magFilter === 'nearest' ? 'NearestFilter' : 'LinearFilter'],
    );
    assert.ok((surface.version as number) > surfaceVersion, 'the values written');
    assert.equal((surface.color as THREE.Color).getHex(), 0xff0000);
  }
});

// #360, #361: a placement and the pixels moved together — an atlas frame drawn and slid in the
// same tick — take both writes: the picture sent again, and the placement composed.
test('a repaint that moves a map’s placement and its pixels together takes both', () => {
  const map = new Texture({ data: new Uint8Array(16), width: 2, height: 2 });
  const paint = material.meshStandard({ map });
  const surface = hostSurface(paint, false, new Map()) as unknown as Record<string, unknown>;
  const host = surface.map as HostTexture & { version: number };
  const record = importHostTexture(host);
  const version = host.version;
  (map.image as { data: Uint8Array }).data[0] = 255;
  map.needsUpdate = true;
  map.offset.set(0.5, 0);
  repaintHostSurface(surface as never, paint);
  assert.ok(host.version > version, 'the pixels sent again');
  followHostTexture(record);
  assert.equal(importHostTexture(host), record);
  assert.equal(record.version, host.version, 'the record refilled at the new version');
  assert.equal(record.transform[6], 0.5, 'the offset reaches the record');
});
