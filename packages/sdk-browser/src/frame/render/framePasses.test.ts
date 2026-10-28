// What a steady visibility image encodes outside its render passes, on the device double that
// records every command opening an encoder of its own (`fakeDevice(BACKEND).commands`): each compute step
// between two render passes is ONE compute pass, and the only clears are the two that open the
// image — the visibility buffer's and the bins' counters —, right before the main pass's binning.
// A pass that ends and a clear that starts each cost the frame an encoder change: the binning is one
// pass, the Hi-Z pyramid another, and the shading bins and the classes' shading share one after the
// surfaces' clear, each clearing what it counts by its own first dispatch. The GPU cut arms its indirect arguments in its own pass: one pass, no copy
// before the readback's. And a uniform whose words did not change is not sent again.
import test from 'node:test'
import assert from 'node:assert/strict'
import { collectClusterPages } from '../../geometry/selection/collect.ts'
import { installGpuGlobals } from '../../../../../tests/kit/fakeDevice/globals.ts'
import { BACKEND } from '../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { occluderScene, preparedOccluderRun } from '../backend/testOccluder.fixture.ts'
import { DEFAULT_SCOPE } from '../../../../sdk-core/src/contracts/base.ts'
import type { ClusterManifest } from '../../../../sdk-core/src/contracts/geometry.ts'
import {
  DAG_SELECTION_PASS,
  MATERIAL_COMPUTE_PASS,
  MATERIAL_SURFACES_PASS,
  RASTER_BINNING_PASS,
  RASTER_IDENTIFIERS_PASS,
  RASTER_DEPTH_EXPORT_PASS,
  RASTER_OCCLUDER_DEPTH_PASS,
  RASTER_TESTED_DEPTH_PASS,
  VISIBILITY_PRIMARY_PASS,
  VISIBILITY_SECONDARY_PASS,
} from '../../diagnostic/stage/passLabels.ts'
import type { Engine } from '../../session/engine/types.ts'
import { packDagSelection } from '../../geometry/dag/pack/pack.ts'
import { backendOf, camera, quadScene } from '../backend/testScenes.fixture.ts'
import { graphDraws } from '../../geometry/selection/drawSource.ts'

test('the compute steps of a visibility image that follow one another are one pass, and nothing clears between them', async () => {
  installGpuGlobals()
  const gpu = fakeDevice(BACKEND)
  const scene = occluderScene()
  const metadata: ClusterManifest = {
    formatVersion: 0,
    status: 'ready',
    key: 'test-occluder',
    scope: DEFAULT_SCOPE,
    sourceTriangles: 0,
    selectedTriangles: 0,
    selectedNodes: 0,
    totalNodes: 0,
    ...scene.metadata,
  }
  const collected = collectClusterPages(
    scene.source,
    graphDraws(scene.source, scene.associations),
    metadata,
    scene.indices,
  )
  const run = await preparedOccluderRun(scene, metadata, collected.roots, gpu.device, [32, 32])
  const backend = run.backend as Engine
  backend.render(run.cam)
  await backend.flush()
  gpu.commands.length = 0
  backend.render(run.cam)
  const frame = gpu.commands.slice()
  // Up to the material surfaces' clear: the visibility buffer; then the material's one compute pass.
  const surfaces = frame.indexOf(`render ${MATERIAL_SURFACES_PASS}`)
  assert.deepEqual(frame.slice(0, surfaces), [
    // The main pass: the cut, the binning that opens the image (its two clears) — the decode of
    // the visible clusters and their bins, which hand the software raster its lists and its
    // dispatch arguments —, the hardware depth, then one compute pass (a frame timed per pass has a
    // pass for each step, the labels they time under): the software depth, its export into the
    // pyramid's level zero and the pyramid built from it.
    `compute ${DAG_SELECTION_PASS}`,
    'clear',
    'clear',
    `compute ${RASTER_BINNING_PASS}`,
    `render ${VISIBILITY_PRIMARY_PASS}`,
    `compute ${RASTER_OCCLUDER_DEPTH_PASS}`,
    // The post pass: the cut's, its readback copied, the bins' counters cleared, then the same steps
    // over what the pyramid held back.
    `compute ${DAG_SELECTION_PASS}`,
    'copy',
    'clear',
    `compute ${RASTER_BINNING_PASS}`,
    `render ${VISIBILITY_SECONDARY_PASS}`,
    `compute ${RASTER_TESTED_DEPTH_PASS}`,
    // The image closed: on a device without the 64-bit atomic maximum the software identifiers of
    // everything drawn, then the export of the buffer both rasters wrote — the identifiers, in the
    // same pass, and the scene's depth by a full-screen draw.
    'copy',
    `compute ${RASTER_IDENTIFIERS_PASS}`,
    `render ${RASTER_DEPTH_EXPORT_PASS}`,
  ])
  assert.equal(frame[surfaces + 1], `compute ${MATERIAL_COMPUTE_PASS}`)
  // The only clears open the image, the two of them right before the main pass's binning, and the
  // post pass's counters.
  const clears = frame.flatMap((command, at) => (command === 'clear' ? [frame[at + 1]] : []))
  assert.deepEqual(
    clears,
    ['clear', `compute ${RASTER_BINNING_PASS}`, `compute ${RASTER_BINNING_PASS}`],
    frame.join(', '),
  )
  backend.dispose()
  scene.geometry.dispose()
  scene.material.dispose()
})

test('the GPU cut is one compute pass, its arguments armed inside it, before the binning', async () => {
  installGpuGlobals()
  const fixture = quadScene()
  const { source, metadata, indices, associations } = fixture
  const collected = collectClusterPages(source, graphDraws(source, associations), metadata, indices)
  const gpu = fakeDevice({ ...BACKEND, packed: packDagSelection(collected.roots) })
  const backend = backendOf({
    ...fixture,
    gpuDevice: gpu.device,
  }) as Engine
  await backend.prepare()
  const cam = camera()
  backend.render(cam)
  await backend.flush()
  cam.lookAt(100, 0, 5)
  cam.updateMatrixWorld()
  gpu.commands.length = 0
  backend.render(cam)
  // The cut's main pass, then the main raster pass's binning — the clears that open the image. The
  // cut's readback is copied by its post pass (`GpuSelection.encodePost`), later in the image.
  assert.deepEqual(gpu.commands.slice(0, gpu.commands.indexOf(`compute ${RASTER_BINNING_PASS}`)), [
    `compute ${DAG_SELECTION_PASS}`,
    'clear',
    'clear',
  ])
  // A view that moves again rewrites what carries the view, not the words it left alone: the
  // bins' options, the pyramid's levels.
  cam.lookAt(90, 0, 5)
  cam.updateMatrixWorld()
  const before = gpu.writes.length
  backend.render(cam)
  const written = new Set(gpu.writes.slice(before).map((write) => write.buffer.label))
  for (const unchanged of ['Trillion3D raster bins uniform', 'Trillion3D HiZ uniforms'])
    assert.equal(written.has(unchanged), false, unchanged)
  assert.equal(written.has('Trillion3D DAG uniforms'), true, 'the view did move')
  await backend.dispose()
  fixture.geometry.dispose()
  fixture.material.dispose()
})
