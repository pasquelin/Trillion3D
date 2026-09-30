// #35: a blended cluster casts a shadow attenuated by its opacity, from a row only the shadow pass
// reads — never from a visibility row.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FLAG_BLEND_CASTER } from '../../visibility/buffer.ts';
import { ROW_BLEND_COVERAGE_WORD, ROW_FLAGS_WORD } from './pageRow.ts';
import { createWebgpuRowSync } from './sync.ts';
import { createWebgpuRowCommit } from './commit.ts';
import { catalogue, mount, STRIDE } from './blendCasters.fixture.ts';
import { NO_ROW } from './noRow.ts';

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
});

// The boss's beam (`site/examples/a-lighthouse-beam.html`): see-through air casts no shadow.
test('a blended surface that does not ask for a shadow takes no caster row', () => {
  const { rows, casters, map, pins } = mount(catalogue(0.22, true, false), 1);
  casters.refresh();
  casters.pin(map);
  assert.equal(rows.blendRowOf[1], -1, 'no caster row');
  assert.deepEqual([pins, casters.used], [[], 0]);
});

test('a blended caster at opacity 0 casts nothing', () => {
  const { rows, casters, map, pins } = mount(catalogue(0), 1);
  casters.refresh();
  casters.pin(map);
  assert.equal(rows.blendRowOf[1], -1, 'no caster row');
  assert.deepEqual(pins, []);
});

test('a blended caster at opacity 1 writes the row of the surface declared opaque, at full coverage', () => {
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
});

test('the opaque visibility tables are the same with or without blended casters', () => {
  const pages = catalogue(0.5);
  const state = (blendSlots: number) => {
    const { rows, writer } = mount(pages, blendSlots);
    const sync = createWebgpuRowSync(
      rows,
      { sync: () => {}, dirty: true },
      pages,
      { drawn: [], drawnPacked: [] },
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

// #875: a blended cluster drawn from its geometry page never fetches an index page; it still casts.
test('a blended caster read from its geometry page takes its row without an index page', () => {
  const pages = catalogue(0.4);
  Object.assign(pages[1], {
    array: undefined,
    geometryPage: { url: 'g1', sha256: 'g', bytes: 64, vertexCount: 3, indexCount: 3, flags: 0 },
  });
  const { rows, casters } = mount(pages, 1);
  casters.refresh();
  assert.equal(rows.blendRowOf[1], rows.blendFirst);
});

test('turning volume transmission off invalidates the existing colored shadow at equal opacity', () => {
  const pages = catalogue(0.5);
  Object.assign(pages.glass, {
    family: 'physical',
    transmission: 1,
    thickness: 0.4,
    needsUpdate: true,
  });
  const { rows, casters, restaled } = mount(pages, 1);
  casters.refresh();
  assert.equal(casters.used, 1);
  Object.assign(pages.glass, { transmission: 0, needsUpdate: true });
  rows.tableEpoch++;
  casters.refresh();
  assert.equal(casters.used, 1, 'the same row now casts an opacity shadow');
  assert.equal(restaled.length, 1, 'cached volume tint must be redrawn');
  assert.equal(restaled[0], pages[1]);
});
