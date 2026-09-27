// #572: a clearcoat written on car-paint-under-clear-coat was no value (#335 named a few), so its
// material became a new entry, its meshes a new batch, and the session was opened again — a black
// frame, then the scene loaded anew. Every field a session does not lay out at opening is a value
// now, written in place, the family of a physical kind included; a cutoff is laid out (`LAYOUT`).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { object } from '../../../../sdk-core/src/world/object/index.ts';
import { geometry } from '../../../../sdk-core/src/world/geometry/index.ts';
import { material } from '../../../../sdk-core/src/world/material/index.ts';
import { createWorldMaterials } from './worldMaterials.ts';
import { hostSurface, repaintHostSurface } from './worldSurface.ts';
import { Scene } from './scene.ts';
import { runtimeOf, sessionStandIn, type Open } from './worldRuntime.fixture.ts';

test('a physical extension, a shininess or an opacity repaints its entry, a cutoff never', () => {
  const table = createWorldMaterials();
  const paint = material.meshPhysical({ color: 0xb31324, clearcoat: 1 });
  const entry = table.entryOf(paint);
  const writes: [string, number][] = [
    ['clearcoat', 0],
    ['clearcoatRoughness', 0.4],
    ['sheen', 0.5],
    ['iridescence', 1],
    ['ior', 1.33],
    ['opacity', 0.5],
  ];
  for (const [field, value] of writes) {
    paint[field] = value;
    assert.equal(table.entryOf(paint), entry, `${field}: the entry kept`);
    assert.deepEqual(table.takeRepainted(), [{ entry, values: true }], field);
    assert.equal(entry.material[field], value, `${field}: the value follows`);
  }
  const shine = material.meshPhong({ shininess: 30 });
  const phong = table.entryOf(shine);
  shine.shininess = 90;
  assert.equal(table.entryOf(shine), phong, 'a shininess is a value');
  shine.specular = 0x222222;
  assert.equal(table.entryOf(shine), phong, 'a colour it did not hold is a value');
  assert.notEqual(phong.material.specular, shine.specular, 'copied, not shared');
  assert.deepEqual(phong.material.specular, shine.specular);
  paint.alphaTest = 0.5;
  const cut = table.entryOf(paint);
  assert.notEqual(cut, entry, 'a cutoff is laid out: a new entry');
  paint.alphaTest = 0.3;
  assert.notEqual(table.entryOf(paint), cut, 'and so is every other cutoff');
  assert.deepEqual(
    table.takeRepainted().map(({ entry: painted }) => painted),
    [phong],
    'only the Phong entry was repainted',
  );
  paint.transmission = 1;
  assert.notEqual(table.entryOf(paint), cut, 'a transmission moves the pass: a new entry');
});

test('a repaint moves a physical kind between the standard and the physical family in place', () => {
  const paint = material.meshStandard({ color: 0x808080 });
  const surface = hostSurface(paint, false, new Map());
  assert.equal(surface.family, 'standard');
  paint.clearcoat = 1;
  paint.clearcoatRoughness = 0.2;
  paint.alphaTest = 0.5;
  paint.opacity = 0.8;
  const version = surface.version;
  repaintHostSurface(surface, paint);
  const fresh = hostSurface(paint, false, new Map());
  for (const field of ['family', 'clearcoat', 'clearcoatRoughness', 'ior', 'alphaTest', 'opacity'])
    assert.equal(surface[field], fresh[field], field);
  assert.ok(surface.version > version, 'every reader takes it at the next version');
  paint.clearcoat = paint.clearcoatRoughness = 0;
  repaintHostSurface(surface, paint);
  assert.equal(surface.family, 'standard', 'and back');
});

test('a clearcoat changed for 60 frames never opens the session again', async () => {
  const ready = Promise.resolve();
  const scene = new Scene(() => Promise.reject(new Error('no loader')));
  const { session } = sessionStandIn();
  let opened = 0;
  const refreshed: (boolean | undefined)[] = [];
  Object.assign(session, { refreshMaterials: (values?: boolean) => refreshed.push(values) > 0 });
  const open = (async () => (opened++, session)) as unknown as Open;
  const runtime = runtimeOf(scene, ready, (error) => assert.fail(String(error)), open);
  const paint = material.meshPhysical({ color: 0xb31324, metalness: 0.72, clearcoat: 1 });
  scene.add(object.mesh(geometry.box(4.6, 0.65, 2), paint));
  scene.add(object.mesh(geometry.box(2.25, 0.72, 1.65), paint));
  await runtime.settled();
  runtime.render();
  for (let frame = 0; frame < 60; frame++) {
    paint.clearcoat = (frame % 10) / 10;
    paint.clearcoatRoughness = frame / 100;
    await runtime.settled();
    runtime.render();
  }
  runtime.dispose();
  assert.equal(opened, 1, 'one session for every value');
  assert.deepEqual(refreshed, Array(60).fill(true), 'its values read again once a frame');
});
