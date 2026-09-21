// Lot F, F18: three calculations of a WebGPU engine prepare. `prepareCones`
// (webgpuPagesPrepare.ts) copies a simple position attribute by block instead of per-vertex
// accessors, and reads the material once instead of twice. `indexSourceBytes` and
// `compteMateriauxEtTangentes` (webgpuPagesCatalogue.ts) replace a `flatMap` of a pair per page and
// a `map`/two table copies with one walk each. The oracles are the implementations from before lot
// F, copied as-is into `oracles/cones-normaux.ts`.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { prepareCones } from './webgpuPagesPrepare.ts';
import { indexSourceBytes, compteMateriauxEtTangentes } from './webgpuPagesCatalogue.ts';
import {
  entreeCones,
  referencePrepareCones,
  referenceIndexSourceBytes,
  referenceCompteMateriauxEtTangentes,
} from './bench/oracles/cones-normaux.ts';
import type { PageRec } from './pageSelection.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

function triangle(material: THREE.Material, attributes: THREE.BufferGeometry['attributes']) {
  return {
    array: Uint32Array.of(0, 1, 2),
    attributes,
    material,
    cone: undefined,
  } as unknown as PageRec;
}
/** Input of `prepareCones`, the bench's: one write for both, or one of the two stays on the old
 *  contract with nothing saying so. */
function runtime(allPages: PageRec[], roots?: Array<{ cones?: boolean; pages: PageRec[] }>) {
  return entreeCones(allPages, roots) as unknown as WebgpuPagesRuntime;
}
const positions = (values: number[]) => new THREE.Float32BufferAttribute(values, 3);

function memeCones(pages: PageRec[]) {
  const a = pages.map((p) => ({ ...p }) as unknown as PageRec);
  const b = pages.map((p) => ({ ...p }) as unknown as PageRec);
  prepareCones(runtime(a));
  referencePrepareCones(runtime(b));
  for (let i = 0; i < a.length; i++) assert.deepEqual(a[i].cone, b[i].cone, `page ${i}`);
}

test('the shared input carries roots, and an ordinary cluster comes out with a real cone', () => {
  // Two functions that post nothing would agree on nothing: equality with the oracle alone does not
  // say a cone was posted. `prepareCones` reads pages by root — an input that carried none would make
  // it ignore everything in silence, and that is exactly the failure this fix closes. This test
  // therefore requires it on both sides: roots, and a non-empty cone.
  const entree = entreeCones([]) as { setup: { allPages: PageRec[]; roots: unknown[] } };
  assert.ok(Array.isArray(entree.setup.roots), 'the bench input must carry its roots');
  const attributes = { position: positions([0, 0, 0, 1, 0, 0, 0, 1, 0]) };
  const page = triangle(new THREE.MeshBasicMaterial({ side: THREE.FrontSide }), attributes);
  prepareCones(runtime([page]));
  assert.ok(page.cone, 'a one-sided cluster must receive its cone');
  assert.equal(page.cone!.axis.length, 3);
});

test('a simple, unnormalized position attribute takes the same cone as the per-vertex copy', () => {
  const attributes = { position: positions([0, 0, 0, 1, 0, 0, 0, 1, 0]) };
  memeCones([triangle(new THREE.MeshBasicMaterial(), attributes)]);
});

test('a normalized attribute goes back through accessors and yields the same cone as the reference', () => {
  const attr = positions([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  attr.normalized = true;
  memeCones([triangle(new THREE.MeshBasicMaterial(), { position: attr })]);
});

test('an interleaved attribute goes back through accessors and yields the same cone as the reference', () => {
  const interleaved = new THREE.InterleavedBuffer(
    Float32Array.of(0, 0, 0, 9, 1, 0, 0, 9, 0, 1, 0, 9),
    4,
  );
  const attr = new THREE.InterleavedBufferAttribute(interleaved, 3, 0, false);
  memeCones([triangle(new THREE.MeshBasicMaterial(), { position: attr })]);
});

test('a double-sided or back-facing material yields OPEN_CONE on both sides, without computing a cone', () => {
  const attributes = { position: positions([0, 0, 0, 1, 0, 0, 0, 1, 0]) };
  memeCones([
    triangle(new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), attributes),
    triangle(new THREE.MeshBasicMaterial({ side: THREE.BackSide }), attributes),
  ]);
});

test('with no index bytes or no position attribute, the page is ignored on both sides (cone left intact)', () => {
  const attributes = { position: positions([0, 0, 0, 1, 0, 0, 0, 1, 0]) };
  const sansArray = { ...triangle(new THREE.MeshBasicMaterial(), attributes), array: undefined };
  const sansPosition = {
    ...triangle(new THREE.MeshBasicMaterial(), {}),
    array: Uint32Array.of(0, 1, 2),
  };
  memeCones([sansArray as unknown as PageRec, sansPosition as unknown as PageRec]);
});

test('two pages sharing the same attribute recompute the flat array only once, same result', () => {
  const attributes = { position: positions([0, 0, 0, 1, 0, 0, 0, 1, 0]) };
  memeCones([
    triangle(new THREE.MeshBasicMaterial(), attributes),
    triangle(new THREE.MeshBasicMaterial({ side: THREE.BackSide }), attributes),
  ]);
});

test('indexSourceBytes yields the same table as the reference flatMap, last page of a winning address', () => {
  const a = { url: 'p/0', array: Uint32Array.of(1, 2, 3) } as unknown as PageRec;
  const b = { url: 'p/1', array: undefined } as unknown as PageRec; // no bytes: absent from both
  const c = { url: 'p/0', array: Uint32Array.of(9, 9) } as unknown as PageRec; // same address as a
  const pages = [a, b, c];
  const obtenu = indexSourceBytes(pages);
  const attendu = referenceIndexSourceBytes(pages);
  assert.deepEqual([...obtenu.keys()], [...attendu.keys()]);
  for (const [url, bytes] of obtenu)
    assert.deepEqual(Array.from(bytes), Array.from(attendu.get(url)));
});

test('indexSourceBytes on an empty catalogue yields an empty table', () => {
  assert.deepEqual(indexSourceBytes([]), referenceIndexSourceBytes([]));
});

test('compteMateriauxEtTangentes counts distinct materials and geometries with/without tangents', () => {
  const materialA = new THREE.MeshBasicMaterial(),
    materialB = new THREE.MeshBasicMaterial();
  const pages = [
    { material: materialA } as unknown as PageRec,
    { material: materialA } as unknown as PageRec, // same material, does not recount
    { material: materialB } as unknown as PageRec,
  ];
  const geometryBlocks = new Map<unknown, { hasTangent: boolean }>([
    ['g0', { hasTangent: true }],
    ['g1', { hasTangent: false }],
    ['g2', { hasTangent: true }],
  ]);
  assert.deepEqual(
    compteMateriauxEtTangentes(pages, geometryBlocks),
    referenceCompteMateriauxEtTangentes(pages, geometryBlocks),
  );
});

test('compteMateriauxEtTangentes on an empty catalogue and geometry table yields zeros', () => {
  assert.deepEqual(
    compteMateriauxEtTangentes([], new Map()),
    referenceCompteMateriauxEtTangentes([], new Map()),
  );
});

test('posting a cone declares its root; a root whose pages receive no cone stays declared bare', () => {
  // `collectClusterPages` declares `cones: false`; without this sample, the cut would no longer read
  // the cone this prepare just wrote, and cone culling would vanish without a sound. A page without
  // index bytes receives no cone: its root has nothing to declare.
  const attributes = { position: positions([0, 0, 0, 1, 0, 0, 0, 1, 0]) };
  const porte = triangle(new THREE.MeshBasicMaterial(), attributes);
  const nue = { ...triangle(new THREE.MeshBasicMaterial(), attributes), array: undefined };
  const roots = [
    { cones: false, pages: [porte] },
    { cones: false, pages: [nue as unknown as PageRec] },
  ];
  prepareCones(runtime([porte, nue as unknown as PageRec], roots));
  assert.equal(roots[0].cones, true);
  assert.equal(roots[1].cones, false);
});
