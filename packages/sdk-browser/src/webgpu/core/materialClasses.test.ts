import test from 'node:test';
import assert from 'node:assert/strict';
import { collectClusterPages } from '../../page/selection/selection.ts';
import { createPageRowWriter } from '../row/pageRow.ts';
import { FLAG_MASK, PAGE_INFO_STRIDE, isTransmissive } from '../../visibility/buffer.ts';
import { SURFACE_MODEL } from '../../scene/surfaceModel.ts';
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
