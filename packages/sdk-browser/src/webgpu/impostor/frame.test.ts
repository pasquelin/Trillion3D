// On WebGPU, a root the impostor plan switches draws its card through the card pipelines —
// into the visibility buffer and depth before the Hi-Z pyramid, then into the surfaces — and its
// card bit leaves it to the card in every camera cut, CPU and GPU, while the light cuts keep its
// shadow: plan and draw agree. The card waits for its atlas, read through the engine's one
// held-level read; until then the root keeps its clusters. Fails on develop: the file is new.
import test from 'node:test'
import assert from 'node:assert/strict'
import '../../impostor/lent.fixture.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { createEngineCamera, readCameraWorld } from '../../camera/world.ts'
import { frontCamera } from '../../page/selection/dag.fixture.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import { CARD_FLOATS } from '../../impostor/cardSlots.ts'
import { viewProj } from '../pages/helpers.ts'
import { drawImpostorVisibility, encodeImpostorCards } from './encode.ts'
import { planWebgpuImpostors } from './frame.ts'
import { recordingEncoder } from './recorder.fixture.ts'
import { IMPOSTOR_PASS, prepareImpostorPipelines } from './pipelines.ts'
import { CARD_ROOT, CASTS_NO_SHADOW } from '../../visibility/shader/spriteWgsl.ts'
import {
  ATLAS_URLS,
  MESH,
  VIEWPORT,
  cutAt as cut,
  engineAt as engineOf,
  impostorScene,
  impostorSection as section,
  settle,
} from '../../impostor/section.fixture.ts'

/** A WebGPU runtime reduced to what the plan and the card pass read, on a recording device whose
 *  card pipelines its prepare checked. */
async function bench() {
  const gpu = fakeDevice()
  assert.ok(await prepareImpostorPipelines(gpu.device, () => {}))
  const { fixture, roots, reader, asked } = impostorScene()
  const marked: Array<[number, number]> = []
  let landed = 0
  const rt = {
    context: { metadata: { impostors: section }, readTextureLevel: reader },
    vis: {},
    setup: { viewport: VIEWPORT, texturePoolBudget: 1 << 20 },
    layout: { selectionRoots: roots },
    diag: { diagnosticFailure: () => undefined },
    gpu: {
      device: gpu.device,
      impostors: undefined,
      targetSize: VIEWPORT,
      depthView: { label: 'depth' },
      surfaces: { views: () => [0, 1, 2, 3].map((label) => ({ label })) },
    },
    run: {
      frame: 0,
      gate: { resourcesChanged: () => landed++, cam: createEngineCamera() },
      gpuDrawCalls: 0,
      gpuSelection: { markWorld: (rank: number, mark: number) => marked.push([rank, mark]) },
    },
  } as unknown as WebgpuPagesRuntime
  return { gpu, rt, roots, fixture, asked, marked, landed: () => landed }
}

/** Images drawn until the atlas landed and was made: each lands what the one before asked. */
async function imagesUntilResident(rt: WebgpuPagesRuntime, z: number) {
  for (let image = 0; image < 3; image++) {
    planWebgpuImpostors(rt, engineOf(z))
    await settle()
  }
}

test('a switched root draws its card in visibility and surfaces once its atlas lands', async () => {
  const { gpu, rt, roots, fixture, asked, marked, landed } = await bench()
  // First image: the atlas is asked through the one reader, and the root keeps its clusters.
  planWebgpuImpostors(rt, engineOf(200))
  assert.equal(roots[0].mark, undefined, 'no card before the atlas: the root stays whole')
  assert.ok(cut(roots, 200).shown.length > 0, 'no hole while the atlas streams')
  assert.deepEqual(
    asked.map((request) => request.url),
    ATLAS_URLS,
  )
  await imagesUntilResident(rt, 200)
  assert.ok(landed() >= 2, 'the landing and the atlas made break a held image')
  const atlas = gpu.textures.filter((t) => t.label?.includes('impostor')).map((t) => t.format)
  assert.deepEqual(atlas, ['rgba8unorm-srgb', 'rgba8unorm', 'rgba8unorm'])
  assert.equal(gpu.imageCopies.length, 3, 'each map copied once to the GPU')
  // The image that switches the root: its card bit set on the root and handed to the GPU cut.
  planWebgpuImpostors(rt, engineOf(200))
  assert.equal(roots[0].mark, CARD_ROOT)
  assert.deepEqual(marked, [[0, CARD_ROOT]], 'the GPU cut leaves it to its card, same image')
  assert.deepEqual(cut(roots, 200).shown, [], 'the CPU cut skips it')
  assert.equal((roots[0].mark ?? 0) & CASTS_NO_SHADOW, 0, 'it keeps its shadow')
  const state = rt.gpu.impostors!
  assert.equal(state.count, 1)
  // The card's record holds no view: its world, the translation in two words, its radius.
  const record = state.slots.records.subarray(0, CARD_FLOATS),
    world = roots[0].world.elements
  for (const k of [0, 1, 2, 4, 5, 6, 8, 9, 10]) assert.equal(record[k], Math.fround(world[k]))
  for (let k = 0; k < 3; k++) assert.equal(record[12 + k] + record[16 + k], world[12 + k])
  assert.equal(record[43], 1, 'the world radius R')
  const toClip = engineOf(200).viewProjection
  const { encoder, open, passes } = recordingEncoder()
  // Visibility: identifier 0, depth and the pyramid's level 0, before the pyramid is built.
  viewProj.set(toClip)
  assert.equal(drawImpostorVisibility(rt, gpu.device, open('primary'), true), true)
  const vis = passes[0].pipeline as GPURenderPipelineDescriptor
  assert.equal(vis.fragment?.entryPoint, 'card_vis_hiz_fs')
  assert.deepEqual(vis.fragment?.targets, [{ format: 'r32uint' }, { format: 'r32float' }])
  assert.equal(vis.depthStencil?.depthCompare, 'greater', 'depth-tested as the clusters')
  assert.equal(vis.depthStencil?.depthWriteEnabled, true)
  const cards = () =>
    gpu.writes.filter((write) => write.buffer.label === 'Trillion3D impostor cards')
  assert.equal(cards()[0]?.size, state.slots.used * CARD_FLOATS, 'the records go up whole once')
  // Surfaces: where the depth is the card's own.
  encodeImpostorCards(rt, encoder)
  const surfaces = passes[1]
  assert.equal(surfaces.label, IMPOSTOR_PASS)
  const pipeline = surfaces.pipeline as GPURenderPipelineDescriptor
  assert.equal(pipeline.vertex.entryPoint, 'card_vs')
  assert.equal(pipeline.depthStencil?.depthCompare, 'greater-equal')
  assert.equal(pipeline.depthStencil?.depthWriteEnabled, false)
  assert.equal(surfaces.groups[1], state.runs[0].group, "the mesh's atlas group")
  assert.deepEqual(surfaces.draws, [[6, 1, 0, 0]], 'one quad, one instance')
  // The next image of the same view writes no record: the GPU turns the card to the camera.
  planWebgpuImpostors(rt, engineOf(200))
  drawImpostorVisibility(rt, gpu.device, open('primary'), true)
  assert.equal(cards().length, 1, 'no record written again')
  fixture.geometry.dispose()
})

test('a near root draws whole again and no card pass is encoded', async () => {
  const { rt, roots, fixture, marked } = await bench()
  await imagesUntilResident(rt, 200)
  planWebgpuImpostors(rt, engineOf(200))
  planWebgpuImpostors(rt, engineOf(5))
  assert.equal(roots[0].mark, undefined, 'its card bit cleared')
  assert.deepEqual(marked.at(-1), [0, 0], 'and handed to the GPU cut')
  assert.ok(cut(roots, 5).shown.length > 0)
  const { encoder, passes } = recordingEncoder()
  encodeImpostorCards(rt, encoder)
  assert.deepEqual(passes, [], 'no card, no pass')
  fixture.geometry.dispose()
})

test('a card out of the view asks no atlas and leaves its root to the card', async () => {
  const { rt, roots, fixture, asked } = await bench()
  const away = frontCamera(200, 5000)
  away.lookAt(0, 0, 400)
  away.updateMatrixWorld()
  planWebgpuImpostors(rt, readCameraWorld(createEngineCamera(), away))
  assert.deepEqual(asked, [], 'residency follows the view')
  assert.equal(roots[0].mark, CARD_ROOT, 'the camera draws nothing of it either way')
  assert.equal(rt.gpu.impostors?.count, 0)
  fixture.geometry.dispose()
})

test('two meshes placed by one shared world each draw their own card', async () => {
  const { rt, roots, fixture } = await bench()
  // A second baked mesh whose root shares the first's world object (`IDENTITY_WORLD` is shared).
  const other = { ...section.meshes[0], mesh: MESH + 1, sourceMesh: MESH + 1 }
  rt.context.metadata.impostors = { ...section, baked: 2, meshes: [section.meshes[0], other] }
  roots.push({ ...roots[0], mesh: MESH + 1 })
  await imagesUntilResident(rt, 200)
  planWebgpuImpostors(rt, engineOf(200))
  for (const root of roots) assert.equal(root.mark, CARD_ROOT, 'each root left to its card')
  const { count, runCount } = rt.gpu.impostors!
  assert.deepEqual([count, runCount], [2, 2], 'a card and an atlas bind per mesh, none dropped')
  fixture.geometry.dispose()
})

test('a root the packed world DAG stands in for draws no card; one it does not hold keeps its own', async () => {
  const { rt, roots, marked } = await bench()
  // Two roots of two baked meshes: one the world holds, one it does not.
  const other = { ...section.meshes[0], mesh: MESH + 1, sourceMesh: MESH + 1 }
  rt.context.metadata.impostors = { ...section, baked: 2, meshes: [section.meshes[0], other] }
  roots.push({ ...roots[0], mesh: MESH + 1 })
  await imagesUntilResident(rt, 200)
  planWebgpuImpostors(rt, engineOf(200))
  assert.equal(roots[0].mark, CARD_ROOT, 'carded while no world DAG is packed')
  assert.equal(rt.gpu.impostors!.count, 2)
  // Root 0 linked to a world object, the others not: a host mesh outside the world's table.
  const selection = rt.run.gpuSelection as { worldStandsIn?: (w: number) => boolean }
  selection.worldStandsIn = (w) => w === 0
  // The cut tells the tier the link moved (`adoptCut`).
  rt.gpu.impostors!.linkMoved(0)
  planWebgpuImpostors(rt, engineOf(200))
  assert.equal(roots[0].mark ?? 0, 0, 'its clusters back, the world gating them')
  assert.ok(
    marked.some(([rank, mark]) => rank === 0 && mark === 0),
    'and the GPU cut told',
  )
  assert.equal(roots[1].mark, CARD_ROOT, 'an unlinked root keeps its card')
  assert.equal(rt.gpu.impostors!.count, 1)
})
