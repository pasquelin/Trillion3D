import test from 'node:test';
import assert from 'node:assert/strict';
import { collectClusterPages } from '../../page/selection/selection.ts';
import { createPageRowWriter, ROW_MATERIAL_CLASS_WORD } from '../row/pageRow.ts';
import { FLAG_MASK, PAGE_INFO_STRIDE, isTransmissive } from '../../visibility/buffer.ts';
import { CLASS_FEATURE } from '../../visibility/shader/materialClass.ts';
import { sceneMaterialClasses } from '../row/pageRowMaterial.ts';
import { createPresentClasses, markPresentClasses } from './materialPasses.ts';
import { SURFACE_MODEL } from '../../scene/surfaceModel.ts';
import { createWebgpuRowState } from '../row/state.ts';
import { scene } from './materialClasses.fixture.ts';

test('the three material classes take the three paths the engine has for them', () => {
  const { source, meshes, metadata, indices, associations } = scene();
  const collected = collectClusterPages(source, metadata, indices, associations);
  // Cut-out and blend both become cluster roots, so both are cut by the GPU selection; only the
  // blend is drawn by the transparent pass. Transmission leaves the DAG as one mesh.
  assert.deepEqual(
    collected.roots.map((root) => root.pages[0].transparent),
    [false, true],
  );
  assert.equal(collected.roots[0].pages[0].sourceMesh, meshes[0], 'the cut-out stays opaque');
  assert.equal(collected.blendCopies.length, 1, 'only transmission leaves the DAG');
  assert.equal(collected.blendCopies[0].userData.sourceMesh, meshes[2]);
  assert.equal(isTransmissive(meshes[2].material), true);
  assert.equal(isTransmissive(meshes[1].material), false, 'a plain blend does not transmit');
});

test('a cut-out cluster carries its alpha test into the visibility row', () => {
  const { source, metadata, indices, associations } = scene();
  const collected = collectClusterPages(source, metadata, indices, associations);
  const floats = new Float32Array(PAGE_INFO_STRIDE / 4),
    ints = new Uint32Array(floats.buffer);
  const writeRow = createPageRowWriter(
    { geometryBlocks: new Map(), mapLayer: new Map(), dataLayer: new Map(), asIsShown: false },
    () => {},
    collected.roots,
    (packed) => packed,
  );
  // A page written as a row belongs to a placement: its collection ranked its root.
  const mask = collected.roots[0].pages[0];
  writeRow(mask, 0, 0, 0, floats, ints);
  assert.equal((ints[23] & FLAG_MASK) !== 0, true, 'the cut-out flag is set');
  assert.equal(floats[19], 0.5, 'the material alpha threshold travels with the row');
  // A blend never becomes a cut-out: its row would otherwise discard instead of blending.
  const blend = Object.assign(collected.roots[1].pages[0], { placementIndex: 1 });
  writeRow(blend, 0, 0, 0, floats, ints);
  assert.equal((ints[23] & FLAG_MASK) !== 0, false);
  assert.equal(floats[19], 1);
});

test('a row carries its resolve class, the census of the scene knows it before any image', () => {
  const { source, metadata, indices, associations } = scene();
  const collected = collectClusterPages(source, metadata, indices, associations);
  const geometryBlocks = new Map(
    collected.roots.map((root) => [
      root.pages[0].attributes,
      {
        vertexBase: 0,
        count: 3,
        hasUv: false,
        hasNormal: true,
        hasTangent: false,
        hasColor: false,
      },
    ]),
  );
  const layers = { mapLayer: new Map(), dataLayer: new Map() };
  const writeRow = createPageRowWriter(
    { geometryBlocks, ...layers, asIsShown: false },
    () => {},
    collected.roots,
    (packed) => packed,
  );
  const floats = new Float32Array(PAGE_INFO_STRIDE / 2),
    ints = new Uint32Array(floats.buffer),
    stride = PAGE_INFO_STRIDE / 4;
  const [mask, blend] = collected.roots.map((root) => root.pages[0]);
  writeRow(mask, 0, 0, 0, floats, ints);
  writeRow(blend, 1, 1, 0, floats, ints);
  const { HAS_MASK, HAS_VERTEX_NORMAL, DOUBLE_SIDED, HAS_UV } = CLASS_FEATURE;
  const cutout = HAS_MASK | HAS_VERTEX_NORMAL | DOUBLE_SIDED;
  assert.equal(ints[ROW_MATERIAL_CLASS_WORD], cutout, 'double-sided cut-out with vertex normals');
  assert.equal(ints[stride + ROW_MATERIAL_CLASS_WORD], HAS_VERTEX_NORMAL, 'the plain blend');
  assert.equal(cutout & HAS_UV, 0, 'no uv block, no uv class bit');
  // The census reads the same fields the rows will carry, for the pages that take a row: the
  // blend is a transparent page and the transmission left the DAG, so the cut-out's class alone
  // is compiled at preparation.
  assert.deepEqual(sceneMaterialClasses(collected.allPages, geometryBlocks, layers), [cutout]);
  // An image draws the classes of its packed rows only: the second row alone leaves the cut-out out.
  const present = createPresentClasses();
  assert.deepEqual(markPresentClasses(ints, 2, present, 0), [cutout, HAS_VERTEX_NORMAL]);
  assert.deepEqual(markPresentClasses(ints.subarray(stride), 1, present, 0), [HAS_VERTEX_NORMAL]);
});

// OMB-11: the image reads its as-is flags from the first opaque row that shows a surface as-is —
// a normal or depth view —; a lit row, or a blended one, which writes no flag, leaves it unread.
test('an opaque row showing a surface as-is tells the image its flags are read', () => {
  const { source, metadata, indices, associations } = scene();
  const collected = collectClusterPages(source, metadata, indices, associations);
  const floats = new Float32Array(PAGE_INFO_STRIDE / 2),
    ints = new Uint32Array(floats.buffer);
  const layers = { geometryBlocks: new Map(), mapLayer: new Map(), dataLayer: new Map() },
    vis = { ...layers, asIsShown: false };
  const writeRow = createPageRowWriter(
    vis,
    () => {},
    collected.roots,
    (packed) => packed,
  );
  const [opaque, blend] = collected.roots.map((root) => root.pages[0]);
  writeRow(opaque, 0, 0, 0, floats, ints);
  assert.equal(vis.asIsShown, false, 'a lit surface');
  blend.material.model = SURFACE_MODEL.normal;
  writeRow(blend, 1, 1, 0, floats, ints);
  assert.equal(vis.asIsShown, false, 'a blended row draws no surface flag');
  opaque.material.model = SURFACE_MODEL.matcap;
  writeRow(opaque, 0, 0, 0, floats, ints);
  assert.equal(vis.asIsShown, false, 'a matcap is drawn unlit, not as-is');
  opaque.material.model = SURFACE_MODEL.depth;
  writeRow(opaque, 0, 0, 0, floats, ints);
  assert.equal(vis.asIsShown, true, 'a depth view is shown as-is');
});

// #410: an image over the same rows reuses its classes; a pose moves none.
test('the classes an image draws are read off the rows again only once a row is written', () => {
  const stride = PAGE_INFO_STRIDE / 4,
    rows = createWebgpuRowState([], 3),
    ints = new Uint32Array(3 * stride),
    present = createPresentClasses();
  rows.packedCount = 3;
  [5, 9, 5].forEach((key, row) => (ints[row * stride + ROW_MATERIAL_CLASS_WORD] = key));
  const classes = () => [...markPresentClasses(ints, rows.packedCount, present, rows.rowWrites)];
  assert.deepEqual(classes(), [5, 9]);
  ints[stride + ROW_MATERIAL_CLASS_WORD] = 5;
  assert.deepEqual(classes(), [5, 9], 'an unmarked word is not reread');
  rows.markRowWords(1);
  assert.deepEqual(classes(), [5, 9], 'a pose keeps the occupant and its class');
  rows.markRowDirty(1);
  assert.deepEqual(classes(), [5]);
  [rows.packedCount, ints[stride + ROW_MATERIAL_CLASS_WORD]] = [2, 9];
  assert.deepEqual(classes(), [5, 9], 'a shorter table is read again');
});
