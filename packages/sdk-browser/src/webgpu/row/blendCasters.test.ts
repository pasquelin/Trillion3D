// #35: a blended cluster casts a shadow attenuated by its opacity, from a row only the shadow pass
// reads — never from a visibility row.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import type { ClusterManifest } from '../../../../sdk-core/src/index.ts';
import { collectClusterPages, type PageRec } from '../../page/selection/selection.ts';
import { FLAG_BLEND_CASTER, PAGE_INFO_STRIDE } from '../../visibility/buffer.ts';
import { BLEND_DITHER } from '../../gpu/shadow/blendCoverage.ts';
import { createPageRowWriter, ROW_BLEND_COVERAGE_WORD, ROW_FLAGS_WORD } from './pageRow.ts';
import { createBlendCasterRows, NO_ROW } from './blendCasters.ts';
import { createWebgpuRowState } from './state.ts';
import { createWebgpuRowSync } from './sync.ts';
import { createWebgpuRowCommit } from './commit.ts';

const STRIDE = PAGE_INFO_STRIDE / 4;
const cluster = (url: string) => ({
  id: 0,
  url,
  count: 3,
  bytes: 12,
  sha256: url,
  min: [-1, -1, 0],
  max: [1, 1, 0],
  role: 'exact' as const,
  start: 0,
  level: 0,
  lodError: 0,
  sphere: [0, 0, 0, 1.5],
  parentError: null,
  parentSphere: null,
  group: null,
  source: null,
});

/** One opaque triangle, then one blended at `opacity`: the catalogue pages, placed. */
function catalogue(opacity: number, blended = true) {
  const source = new G.Group(),
    associations = new Map<G.Object3D, { meshes: number; primitives: number }>();
  const materials = [
    G.standardSurface(),
    G.standardSurface({ transparent: blended, opacity: blended ? opacity : 1 }),
  ];
  const primitives = materials.map((material, index) => {
    const geometry = new G.GraphGeometry();
    geometry.setAttribute('position', G.floatAttribute([-1, -1, 0, 1, -1, 0, 0, 1, 0], 3));
    geometry.setIndex(G.indices([0, 1, 2]));
    const mesh = G.mesh(geometry, material);
    source.add(mesh);
    associations.set(mesh, { meshes: index, primitives: 0 });
    const pass = blended && index ? 'clustered-blend' : 'exact-clusters';
    const structure = { version: 1, roots: [0], groups: [] };
    return { mesh: index, primitive: 0, pass, pages: [cluster(`p${index}`)], structure };
  });
  source.updateMatrixWorld(true);
  const metadata = { primitives } as unknown as ClusterManifest;
  const indices = new Map(primitives.map((_, i) => [`p${i}`, Uint32Array.of(0, 1, 2)] as const));
  const collected = collectClusterPages(source, metadata, indices, associations);
  const pages = collected.allPages.map((rec, i) => Object.assign(rec, { placementIndex: i }));
  return Object.assign(pages, { glass: materials[1] });
}

/** The row table over `pages` with `blendSlots` shadow-only rows, both pages resident. */
function mount(pages: PageRec[], blendSlots: number) {
  const rows = createWebgpuRowState(pages, 1, blendSlots);
  rows.pageTableFloats = new Float32Array(rows.casterSlots * STRIDE);
  rows.pageTableInts = new Uint32Array(rows.pageTableFloats.buffer);
  const geometryBlock = { vertexBase: 0, count: 3, hasUv: false, hasNormal: false };
  const writer = createPageRowWriter({
    geometryBlocks: new Map(pages.map((p) => [p.attributes, { ...geometryBlock }] as const)),
    mapLayer: new Map(),
    dataLayer: new Map(),
    markRowDirty: rows.markRowDirty,
  } as never);
  pages.forEach((_, page) => {
    rows.pagePositions[page] = {} as GPUBuffer;
    rows.residentOffsetWords[page] = page * 16;
    rows.touchPage(page);
  });
  const pins: Array<[number, number]> = [];
  const map = { pin: (page: number, row: number) => pins.push([page, row]) };
  const restaled: PageRec[] = [];
  const casters = createBlendCasterRows(rows, pages, writer, (rec) => restaled.push(rec));
  return { rows, writer, casters, map, pins, restaled };
}

/** Texels a 4×4 block keeps at `coverage`: the shadow raster's test, `coverage > threshold`. */
const kept = (coverage: number) => BLEND_DITHER.filter((threshold) => coverage > threshold).length;

test('a blended caster is listed in a shadow-only row and pinned where the light cull reads', () => {
  const pages = catalogue(0.4);
  const { rows, casters, map, pins, restaled } = mount(pages, 1);
  casters.refresh();
  const row = rows.blendRowOf[1];
  assert.equal(row, rows.blendFirst, 'the first row behind the visibility rows');
  assert.equal(rows.packedRecs[row], pages[1]);
  assert.ok(rows.pageTableInts![row * STRIDE + ROW_FLAGS_WORD] & FLAG_BLEND_CASTER);
  assert.equal(rows.pageTableFloats![row * STRIDE + ROW_BLEND_COVERAGE_WORD], Math.fround(0.4));
  assert.ok(rows.dirtyMarks[row], 'its row is uploaded with the table');
  casters.pin(map);
  assert.deepEqual(pins, [[1, row]], 'the light cull finds the page at its caster row');
  assert.equal(casters.used, 1);
  // The host writes another opacity: the row follows, and the shadow under it is drawn again.
  assert.deepEqual(restaled, [], 'taking the row restales nothing: residency did');
  pages.glass.opacity = 0.8;
  rows.tableEpoch++;
  casters.refresh();
  assert.equal(rows.pageTableFloats![row * STRIDE + ROW_BLEND_COVERAGE_WORD], Math.fround(0.8));
  assert.deepEqual(restaled, [pages[1]]);
  // Down to opacity 0 then back: the row is given back, then taken again, each time restaled.
  for (const opacity of [0, 0.4]) {
    pages.glass.opacity = opacity;
    rows.tableEpoch++;
    casters.refresh();
  }
  assert.deepEqual(restaled, [pages[1], pages[1], pages[1]]);
  casters.pin(map);
  // It leaves residency: the row is given back and the map forgets the page.
  rows.residentOffsetWords[1] = -1;
  casters.follow(1);
  casters.pin(map);
  assert.deepEqual(pins.at(-1), [1, NO_ROW]);
  assert.equal(casters.used, 0);
  // Its shadow keeps its opacity's share of the map texels, which the PCF averages.
  assert.equal(kept(0.4), Math.round(0.4 * 16));
});

test('a blended caster at opacity 0 casts nothing', () => {
  const { rows, casters, map, pins } = mount(catalogue(0), 1);
  casters.refresh();
  casters.pin(map);
  assert.equal(rows.blendRowOf[1], -1, 'no caster row');
  assert.deepEqual(pins, []);
  assert.equal(kept(0), 0, 'and a coverage of zero keeps no texel');
});

test('a blended caster at opacity 1 casts as the same surface declared opaque', () => {
  const blend = mount(catalogue(1), 1);
  blend.casters.refresh();
  const row = blend.rows.blendRowOf[1];
  const opaquePages = catalogue(1, false);
  const opaque = mount(opaquePages, 1);
  opaque.writer(
    opaquePages[1],
    1,
    row,
    16,
    opaque.rows.pageTableFloats!,
    opaque.rows.pageTableInts!,
  );
  const words = (ints: Uint32Array) => Array.from(ints.subarray(row * STRIDE, (row + 1) * STRIDE));
  const a = words(blend.rows.pageTableInts!),
    b = words(opaque.rows.pageTableInts!);
  assert.equal(a[ROW_FLAGS_WORD], b[ROW_FLAGS_WORD] | FLAG_BLEND_CASTER);
  assert.equal(blend.rows.pageTableFloats![row * STRIDE + ROW_BLEND_COVERAGE_WORD], 1);
  a[ROW_FLAGS_WORD] = b[ROW_FLAGS_WORD];
  a[ROW_BLEND_COVERAGE_WORD] = b[ROW_BLEND_COVERAGE_WORD];
  assert.deepEqual(a, b, 'the same geometry, pose and material words as the opaque caster');
  assert.equal(kept(1), 16, 'every texel keeps its depth: the opaque depth, to the bit');
});

test('the opaque visibility tables are the same with or without blended casters', () => {
  const pages = catalogue(0.5);
  const state = (blendSlots: number) => {
    const { rows, writer } = mount(pages, blendSlots);
    const sync = createWebgpuRowSync(
      rows,
      { sync: () => {}, dirty: true },
      pages,
      [],
      1,
      () => true,
      createWebgpuRowCommit(rows, writer),
    );
    sync.syncRows();
    return {
      blendRow: rows.blendRowOf[1],
      rowCount: rows.rowCount,
      packedCount: rows.packedCount,
      packedPageIndex: Array.from(rows.packedPageIndex.subarray(0, rows.blendFirst)),
      rowOfPage: Array.from(rows.rowOfPage),
      table: Array.from(rows.pageTableInts!.subarray(0, rows.blendFirst * STRIDE)),
    };
  };
  const { blendRow: none, ...without } = state(0),
    { blendRow, ...withCasters } = state(1);
  assert.deepEqual([none, blendRow], [-1, 1], 'the caster row sits behind the one visibility row');
  assert.deepEqual(withCasters, without);
  assert.deepEqual(without.rowOfPage, [0, -1], 'the blended page holds no visibility row');
});
