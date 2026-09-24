import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import * as THREE from 'three';
import type { PageRec } from '../../page/selection/selection.ts';
import type { HostGeometry } from '../../host/resources.ts';
import { heldFloorBytes, pageCopies, residentPages } from './poolApi.ts';

/** A page geometry of `floats` position floats and three indices: `floats * 4 + 12` bytes. */
function pageGeometry(floats: number) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(floats), 3));
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(3), 1));
  return geometry as unknown as HostGeometry;
}

const rec = (url: string, extra: Partial<PageRec> = {}) => ({ url, ...extra }) as PageRec;

test('page copies follow the records that own a geometry, and the classic instances', () => {
  let instances = 0;
  const placed = { placement: {} } as Partial<PageRec>;
  const byUrl = new Map([
    ['root', [rec('root')]],
    ['twice', [rec('twice'), rec('twice')]],
    ['rows', [rec('rows', placed), rec('rows', placed), rec('rows', placed)]],
  ]);
  const copies = pageCopies(byUrl, new Set(['root']), () => instances);
  assert.deepEqual(
    [copies.of('root'), copies.of('twice'), copies.of('rows'), copies.root(), copies.scene()],
    [1, 2, 1, 1, 4],
    'rows share one geometry',
  );
  instances = 2;
  assert.equal(copies.generation, 2);
  assert.deepEqual(
    [copies.of('twice'), copies.of('rows'), copies.root(), copies.scene(), copies.most()],
    [6, 1, 3, 10, 7],
    'each instance clones every owned geometry, the rows still share theirs',
  );
});

test('the floor counts the root cover and the replaced pages, a shared geometry once', () => {
  const gate = { revisions: { scene: 1, view: 1, resources: 1 } };
  const shared = pageGeometry(9),
    replaced = pageGeometry(30);
  const bootstrap = [rec('root', { geometry: shared }), rec('root', { geometry: shared })];
  const byUrl = new Map([['page', [rec('page', { geometry: replaced })]]]);
  const modifiedPages = new Set<string>();
  const floor = heldFloorBytes({ gate, bootstrap, modifiedPages, byUrl });
  assert.equal(floor(), 9 * 4 + 12);
  // Only a new scene revision or a newly replaced page reads the records again.
  bootstrap.push(rec('root', { geometry: pageGeometry(3) }));
  assert.equal(floor(), 9 * 4 + 12, 'nothing is walked while nothing announced a change');
  gate.revisions.scene++;
  assert.equal(floor(), 9 * 4 + 12 + 3 * 4 + 12);
  modifiedPages.add('page');
  assert.equal(floor(), 9 * 4 + 12 + 3 * 4 + 12 + 30 * 4 + 12);
});

test('resident pages are counted by page, as the pool evicts them', () => {
  const held = new Uint32Array(3);
  const byUrl = new Map([
    ['a', [rec('a', { array: held }), rec('a', { array: held })]],
    ['b', [rec('b')]],
  ]);
  assert.equal(residentPages(byUrl), 1);
});

test('the WebGL2 pool imports no code of the WebGPU engine', () => {
  const directory = new URL('.', import.meta.url);
  for (const name of readdirSync(directory).filter((file) => !file.includes('.test.'))) {
    const source = readFileSync(new URL(name, directory), 'utf8');
    for (const [statement, type] of source.matchAll(
      /import (type )?[^;]*? from '[^']*\/webgpu\/[^']*'/g,
    ))
      assert.ok(type, `${name}: ${statement}`);
  }
});
