// On WebGPU, a root the impostor plan switches draws its card through the card pipelines —
// into the visibility buffer and depth before the Hi-Z pyramid, then into the surfaces — and its
// card bit leaves it to the card in every camera cut, CPU and GPU, while the light cuts keep its
// shadow: plan and draw agree. The card reads its maps in the one tile pool (#1527): it waits for
// every tile it reads, asked of the pool; until then the root keeps its clusters. No texture is
// made per mesh, and every card of every mesh draws through one tile group. Fails on the old code:
// each mesh had three textures and a group of its own.
import test from 'node:test'
import assert from 'node:assert/strict'
import '../../impostor/lent.fixture.ts'
import { engineCamera } from '../../camera/camera.fixture.ts'
import { frontCamera } from '../../page/selection/dag.fixture.ts'
import { CARD_FLOATS } from '../../impostor/cardSlots.ts'
import { viewProj } from '../pages/helpers.ts'
import { drawImpostorVisibility, encodeImpostorCards } from './encode.ts'
import { planWebgpuImpostors } from './frame.ts'
import { TILES, bench } from './frame.fixture.ts'
import { IMPOSTOR_PASS } from '../../stage/passLabels.ts'
import { CARD_ROOT, CASTS_NO_SHADOW } from '../../visibility/shader/spriteWgsl.ts'
import {
  MESH,
  cutAt as cut,
  engineAt as engineOf,
  impostorSection as section,
} from '../../impostor/section.fixture.ts'

test('a switched root draws its card in visibility and surfaces once its tiles reside', async () => {
  const { gpu, rt, roots, fixture, asks, marked, land } = await bench()
  // First image: the maps' tiles are asked of the pool, and the root keeps its clusters.
  planWebgpuImpostors(rt, engineOf(200))
  assert.equal(roots[0].mark, undefined, 'no card before its tiles: the root stays whole')
  assert.ok(cut(roots, 200).shown.length > 0, 'no hole while the tiles stream')
  assert.equal(asks.length, 1, 'its maps asked once an image')
  assert.deepEqual(asks[0].tiles, TILES)
  assert.ok(asks[0].from <= asks[0].to && asks[0].pixels > 0)
  assert.equal(
    gpu.textures.filter((t) => t.label?.includes('impostor')).length,
    0,
    'no texture of its own',
  )
  land()
  // The image that switches the root: its card bit set on the root and handed to the GPU cut.
  planWebgpuImpostors(rt, engineOf(200))
  assert.equal(roots[0].mark, CARD_ROOT)
  assert.deepEqual(marked, [[0, CARD_ROOT]], 'the GPU cut leaves it to its card, same image')
  assert.deepEqual(cut(roots, 200).shown, [], 'the CPU cut skips it')
  assert.equal((roots[0].mark ?? 0) & CASTS_NO_SHADOW, 0, 'it keeps its shadow')
  const state = rt.gpu.impostors!
  assert.equal(state.count, 1)
  // The card's record holds no view: its world, the translation in two words, its radius, its maps.
  const record = state.slots.records.subarray(0, CARD_FLOATS),
    world = roots[0].world.elements
  for (const k of [0, 1, 2, 4, 5, 6, 8, 9, 10]) assert.equal(record[k], Math.fround(world[k]))
  for (let k = 0; k < 3; k++) assert.equal(record[12 + k] + record[16 + k], world[12 + k])
  assert.equal(record[43], 1, 'the world radius R')
  assert.deepEqual([...record.subarray(44, 47)], [...TILES], 'its three maps by slot')
  const toClip = engineOf(200).viewProjection
  const encoder = gpu.device.createCommandEncoder(),
    first = gpu.passDescriptors.length
  const open = (label: string) => encoder.beginRenderPass({ label, colorAttachments: [] })
  /** The draws of the `k`-th pass begun on `encoder`. */
  const drawsOf = (k: number) => gpu.draws.filter((draw) => draw.pass === first + k)
  // Visibility: the card's identifier, depth and the pyramid's level 0, before the pyramid is built.
  viewProj.set(toClip)
  assert.equal(drawImpostorVisibility(rt, gpu.device, open('primary'), true), true)
  const [vis] = drawsOf(0)
  assert.equal(vis.pipeline.fragment?.entryPoint, 'card_vis_hiz_fs')
  assert.deepEqual(vis.pipeline.fragment?.targets, [{ format: 'r32uint' }, { format: 'r32float' }])
  assert.equal(vis.pipeline.depthStencil?.depthCompare, 'greater', 'depth-tested as the clusters')
  assert.equal(vis.pipeline.depthStencil?.depthWriteEnabled, true)
  const tiles = gpu.bindGroups.filter((group) => group.label === 'Trillion3D impostor tiles')
  assert.equal(tiles.length, 1, 'one tile group')
  assert.equal(vis.groups[1], tiles[0])
  const cards = () =>
    gpu.writes.filter((write) => write.buffer.label === 'Trillion3D impostor cards')
  assert.equal(cards()[0]?.size, state.slots.used * CARD_FLOATS, 'the records go up whole once')
  // Surfaces: where the identifier kept is the card's own, read by equality: no depth is compared;
  // the feedback target beside them, loaded, its pixels asking the tiles they read.
  encodeImpostorCards(rt, encoder)
  const surfacePass = gpu.passDescriptors[first + 1] as GPURenderPassDescriptor | undefined
  assert.equal(surfacePass?.label, IMPOSTOR_PASS)
  const attachments = [...surfacePass!.colorAttachments]
  assert.equal(attachments.length, 5)
  assert.equal(attachments[4]?.loadOp, 'load', 'the resolve’s requests kept')
  const [surface] = drawsOf(1)
  assert.equal(surface.pipeline.vertex?.entryPoint, 'card_vs')
  assert.equal(surface.pipeline.fragment?.entryPoint, 'card_feedback_fs')
  assert.equal([...(surface.pipeline.fragment?.targets ?? [])].at(-1)?.format, 'r32uint')
  assert.equal(surface.pipeline.depthStencil, undefined, 'no depth, written or compared')
  assert.ok(surface.groups[2], 'the identifiers the visibility stage kept')
  assert.equal(surface.groups[1], tiles[0], 'the one tile group')
  assert.deepEqual(
    drawsOf(1).map((d) => [d.vertexCount, d.instanceCount, d.firstVertex, d.firstInstance]),
    [[4, 1, 0, 0]],
    'one quad — a strip of four corners —, one instance',
  )
  // The next image of the same view writes no record: the GPU turns the card to the camera.
  planWebgpuImpostors(rt, engineOf(200))
  drawImpostorVisibility(rt, gpu.device, open('primary'), true)
  assert.equal(cards().length, 1, 'no record written again')
  fixture.geometry.dispose()
})

test('a card whose tiles leave gives its root back its clusters', async () => {
  const { rt, roots, fixture, land } = await bench()
  land()
  planWebgpuImpostors(rt, engineOf(200))
  assert.equal(roots[0].mark, CARD_ROOT)
  land(false)
  planWebgpuImpostors(rt, engineOf(200))
  assert.equal(roots[0].mark ?? 0, 0, 'its clusters drawn again, never a coarser card')
  assert.equal(rt.gpu.impostors!.count, 0)
  fixture.geometry.dispose()
})

test('a near root draws whole again and no card pass is encoded', async () => {
  const { gpu, rt, roots, fixture, marked, land } = await bench()
  land()
  planWebgpuImpostors(rt, engineOf(200))
  planWebgpuImpostors(rt, engineOf(5))
  assert.equal(roots[0].mark, undefined, 'its card bit cleared')
  assert.deepEqual(marked.at(-1), [0, 0], 'and handed to the GPU cut')
  assert.ok(cut(roots, 5).shown.length > 0)
  const begun = gpu.passDescriptors.length
  encodeImpostorCards(rt, gpu.device.createCommandEncoder())
  assert.equal(gpu.passDescriptors.length, begun, 'no card, no pass')
  fixture.geometry.dispose()
})

test('a card out of the view asks no tile and leaves its root to the card', async () => {
  const { rt, roots, fixture, asks } = await bench()
  const away = frontCamera(200, 5000)
  away.lookAt(0, 0, 400)
  away.updateMatrixWorld()
  planWebgpuImpostors(rt, engineCamera(away))
  assert.deepEqual(asks, [], 'residency follows the view')
  assert.equal(roots[0].mark, CARD_ROOT, 'the camera draws nothing of it either way')
  assert.equal(rt.gpu.impostors?.count, 0)
  fixture.geometry.dispose()
})

test('two meshes placed by one shared world each draw their own card, in one tile group', async () => {
  const { gpu, rt, roots, fixture, land } = await bench()
  // A second baked mesh whose root shares the first's world object (`IDENTITY_WORLD` is shared).
  const other = { ...section.meshes[0], mesh: MESH + 1, sourceMesh: MESH + 1 }
  rt.context.metadata.impostors = { ...section, baked: 2, meshes: [section.meshes[0], other] }
  roots.push({ ...roots[0], mesh: MESH + 1 })
  land()
  planWebgpuImpostors(rt, engineOf(200))
  for (const root of roots) assert.equal(root.mark, CARD_ROOT, 'each root left to its card')
  const { count, runCount } = rt.gpu.impostors!
  assert.deepEqual([count, runCount], [2, 2], 'a card and a draw per mesh, none dropped')
  viewProj.set(engineOf(200).viewProjection)
  const encoder = gpu.device.createCommandEncoder()
  drawImpostorVisibility(rt, gpu.device, encoder.beginRenderPass({ colorAttachments: [] }), true)
  const groups = gpu.bindGroups.filter((group) => group.label?.startsWith('Trillion3D impostor'))
  assert.deepEqual(
    groups.map((group) => group.label).sort(),
    ['Trillion3D impostor image', 'Trillion3D impostor tiles'],
    'no group of its own per mesh',
  )
  fixture.geometry.dispose()
})

test('a root the packed world DAG stands in for draws no card; one it does not hold keeps its own', async () => {
  const { rt, roots, marked, land } = await bench()
  // Two roots of two baked meshes: one the world holds, one it does not.
  const other = { ...section.meshes[0], mesh: MESH + 1, sourceMesh: MESH + 1 }
  rt.context.metadata.impostors = { ...section, baked: 2, meshes: [section.meshes[0], other] }
  roots.push({ ...roots[0], mesh: MESH + 1 })
  land()
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
