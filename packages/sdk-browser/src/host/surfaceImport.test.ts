// The import boundary's own contract: what a texture record keeps between two reads, and when it
// is refilled. Everything downstream — atlas layers, preview ranks, lane pools, the WebGL2 binder
// — addresses a texture by the identity of its record and reads the UV transform it holds, so the
// identity, the refill on a version bump and the aliased transform are the boundary's promises.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { followHostTexture, importHostSurface, importHostTexture } from './surfaceImport.ts';

const texture = () => {
  const map = new THREE.DataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
  map.needsUpdate = true;
  return map;
};

test('One host texture keeps one record for the session', () => {
  const host = texture();
  const first = importHostTexture(host);
  assert.equal(importHostTexture(host), first, 'a second read returns the held record');
  const surface = importHostSurface(new THREE.MeshStandardMaterial({ map: host }));
  assert.equal(surface?.map, first, 'a surface reads the same record as a direct import');
});

test('A version bump refills the held record instead of returning a second one', () => {
  const host = texture();
  const record = importHostTexture(host);
  assert.equal(record.wrapS, 'clamp');
  host.wrapS = THREE.RepeatWrapping;
  host.anisotropy = 4;
  host.needsUpdate = true;
  const refilled = importHostTexture(host);
  assert.equal(refilled, record, 'the record the pools address keeps its identity');
  assert.equal(refilled.wrapS, 'repeat');
  assert.equal(refilled.anisotropy, 4);
});

test('The record aliases the composed UV transform, so a later recomposition is read', () => {
  const host = texture();
  const record = importHostTexture(host);
  assert.deepEqual([...record.transform], [...host.matrix.elements], 'composed once at import');
  host.offset.set(0.25, 0.5);
  host.updateMatrix();
  assert.deepEqual(
    [...record.transform],
    [...host.matrix.elements],
    'the held record reads the recomposition without a re-import',
  );
  assert.notEqual(record.transform[6], 0, 'the offset reached the transform');
});

// #360: a host animates a placement the way Three lets it — repeat, offset or rotation written,
// the texture's version untouched —: the matrix is recomposed once per image, as the host's own
// renderer recomposes it at every draw, and the held record reads it.
test('A placement written without a version is recomposed at the next image', () => {
  const host = texture();
  const material = new THREE.MeshStandardMaterial({ map: host });
  const record = importHostSurface(material)!.map!;
  const version = host.version;
  host.offset.set(0.25, 0.5);
  host.rotation = Math.PI / 2;
  followHostTexture(record);
  assert.equal(importHostSurface(material)!.map, record, 'the same record');
  assert.equal(host.version, version, 'no texture version moved');
  assert.deepEqual([record.transform[6], record.transform[7]], [0.25, 0.5]);
  assert.ok(Math.abs(record.transform[0]) < 1e-9, 'the quarter turn read');
});

test('A material is read in one place, and never cached: a replaced map is seen as it stands', () => {
  const material = new THREE.MeshStandardMaterial({ map: texture() });
  assert.equal(importHostSurface(material)?.map, importHostTexture(material.map!));
  const second = texture();
  material.map = second;
  assert.equal(importHostSurface(material)?.map, importHostTexture(second));
});

// #360, #361: Three's order as often as the other — `needsUpdate`, then the filter —: nothing is
// read at `needsUpdate`, the record is brought up at the next image, the filter with it.
test('A filter written after needsUpdate reaches the record at the next image', () => {
  const host = texture();
  const record = importHostTexture(host);
  host.needsUpdate = true;
  host.magFilter = THREE.LinearFilter;
  assert.equal(record.magFilter, 'nearest', 'nothing read at needsUpdate');
  followHostTexture(record);
  assert.equal(record.magFilter, 'linear');
  assert.equal(record.version, host.version);
});
