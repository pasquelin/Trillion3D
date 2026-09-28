import test from 'node:test';
import assert from 'node:assert/strict';
import { material } from '../../../../sdk-core/src/world/material/index.ts';
import type { DrawnTriangles } from '../../../../sdk-core/src/world/geometry/drawn.ts';
import type { HostMesh } from '../../host/resources.ts';
import type { GraphSurface } from '../../host/graph/surface.ts';
import type { PlacementRows } from '../../placement/rows.ts';
import { buildWorldMirror } from './worldMirror.ts';
import type { Cut } from './worldCuts.ts';

const cut = (colors: boolean): Cut => {
  const drawn: DrawnTriangles = {
    positions: new Float32Array(9),
    normals: new Float32Array(9),
    uvs: null,
    colors: colors ? new Float32Array(12).fill(0.5) : null,
    indices: new Uint32Array([0, 1, 2]),
  };
  return { key: String(colors), drawn, runtime: {} as never, users: new Set(), held: false };
};

/** The one surface a mirror mesh wears. */
const worn = (mesh: HostMesh) => mesh.material as GraphSurface;

const vertexColorsOf = (vertexColors: boolean, colors: boolean) => {
  const paint = material.meshStandard({ color: 0xffffff, vertexColors });
  const placed = [{ cut: cut(colors), material: paint, rows: {} as PlacementRows, name: 'm' }];
  const { root } = buildWorldMirror({ placed, models: [], rankOf: () => 0 });
  return worn(root.children[0] as HostMesh).vertexColors;
};

// #347: the material decides, as `material.vertexColors` does in the reference; a geometry's
// `color` attribute alone tints nothing, and a geometry without one has nothing to tint by.
test('a world surface tints by vertex colours only when its material asks', () => {
  assert.equal(vertexColorsOf(false, true), false, 'coloured geometry, material says no');
  assert.equal(vertexColorsOf(true, true), true, 'coloured geometry, material says yes');
  assert.equal(vertexColorsOf(true, false), false, 'no colour to tint by');
  assert.equal(vertexColorsOf(false, false), false);
});

test('one material worn with and without colours gets one surface per case, both repainted', () => {
  const paint = material.meshStandard({ color: 0x3c8ce0, vertexColors: true });
  const rows = {} as PlacementRows;
  const placed = [true, false, true].map((c) => ({ cut: cut(c), material: paint, rows, name: '' }));
  const { root, repaint } = buildWorldMirror({ placed, models: [], rankOf: () => 0 });
  const [a, b, c] = root.children as HostMesh[];
  assert.equal(a.material, c.material, 'the coloured surface is shared');
  assert.notEqual(a.material, b.material);
  const versions = [a, b].map((mesh) => worn(mesh).version);
  paint.color.set(0xff0000);
  const entry = { id: 0, key: '', material: paint };
  const refreshed: boolean[] = [];
  assert.equal(
    repaint([{ entry, values: true }], (values) => refreshed.push(values) > 0),
    true,
  );
  assert.deepEqual(refreshed, [true], 'the session reads them again once');
  [a, b].forEach((mesh, i) => assert.ok(worn(mesh).version > versions[i]!));
});

test('an unmounted host surface leaves the cache: disposed, and no repaint writes it', (t) => {
  const [kept, gone] = [0x808080, 0x1d6d8c].map((color) => material.meshStandard({ color }));
  const rows = {} as PlacementRows;
  const placed = [kept, gone, gone].map((paint) => ({ cut: cut(false), material: paint, rows }));
  const mirror = buildWorldMirror({
    placed: placed.map((batch) => ({ ...batch, name: '' })),
    models: [],
    rankOf: () => 0,
  });
  const [, first, second] = mirror.placed.map(({ node }) => node as HostMesh);
  const surface = worn(first);
  const disposed = t.mock.method(surface, 'dispose');
  mirror.unplace(first as never);
  assert.equal(disposed.mock.callCount(), 0, 'another mesh still wears it');
  mirror.unplace(second as never);
  assert.equal(disposed.mock.callCount(), 1, 'given back with its last mesh');
  const version = surface.version,
    refreshed: boolean[] = [];
  const entry = { id: 0, key: '', material: gone };
  mirror.repaint([{ entry, values: true }], (values) => refreshed.push(values) > 0);
  assert.deepEqual([surface.version, refreshed], [version, []], 'the repaint finds nothing');
  assert.equal(mirror.root.children.length, 1, 'the other resource stays');
});
