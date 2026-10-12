import test from 'node:test'
import assert from 'node:assert/strict'
import { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts'
import { Material } from '../../../../sdk-core/src/world/material/material.ts'
import { Group, Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts'
import { createPlacementRows } from '../../placement/rows.ts'
import type { LoadedModel } from './loadedModel.ts'
import { createWorldModels } from './worldModels.ts'
import { createWorldRanks } from './worldRanks.ts'
import { createWorldPoses } from './worldPoses.ts'
import { model } from './worldModels.fixture.ts'

test('each drawn mesh of a model is a source at one row, its ranks moved past the models before', () => {
  const models = createWorldModels(createWorldRanks())
  const first = model([{ meshes: 0 }, { meshes: 1 }]),
    second = model([{ meshes: 0 }])
  const a = models.drawsOf(first.loaded),
    b = models.drawsOf(second.loaded)
  assert.deepEqual(
    a.draws.map((draw) => [draw.mesh, draw.rows?.capacity]),
    [
      [0, 1],
      [1, 1],
    ],
  )
  assert.equal(b.draws[0].mesh, 2, 'its block starts past the first model’s')
  assert.equal(models.drawsOf(first.loaded), a, 'made once')
  assert.equal(a.draws[0].declaration, first.drawn[0].material)
  assert.equal(a.draws[0].node, undefined, 'no node stands for it')
  assert.equal(a.draws[0].rows?.sources?.[0], first.drawn[0], 'the mesh stays its animation source')
})

test('posing a model writes the row of each mesh from its graph, shown or not', () => {
  const models = createWorldModels(createWorldRanks())
  const { loaded, drawn } = model([{ meshes: 0 }, { meshes: 1 }])
  drawn[0].position.set(0, 2, 0)
  loaded.position.set(3, 0, 0)
  loaded.updateMatrixWorld(true)
  const { rowed } = models.drawsOf(loaded)
  models.pose(loaded, true)
  const row = (at: number) => Array.from(rowed[at].rows.matrices.slice(12, 15))
  assert.deepEqual(
    [row(0), row(1)],
    [
      [3, 2, 0],
      [3, 0, 0],
    ],
  )
  assert.deepEqual([rowed[0].rows.live[0], rowed[1].rows.live[0]], [1, 1])
  drawn[1].visible = false
  loaded.position.set(5, 0, 0)
  loaded.updateMatrixWorld(true)
  models.pose(loaded, true)
  assert.deepEqual(
    [row(0), rowed[1].rows.live[0]],
    [[5, 2, 0], 0],
    'moved, and a hidden mesh parked',
  )
  models.pose(loaded, false)
  assert.deepEqual([rowed[0].rows.live[0], rowed[1].rows.live[0]], [0, 0], 'the model hidden')
})

test('a model never built is never posed, and a mesh the cells place keeps their rows', () => {
  const models = createWorldModels(createWorldRanks())
  const placements = createPlacementRows(4)
  const { loaded, drawn } = model([{ meshes: 0, placements }])
  assert.equal(models.pose(loaded, true), undefined)
  const [draw] = models.drawsOf(loaded).draws
  assert.equal(draw.rows, placements, 'the cells’ rows, read where the loader keeps them')
  assert.equal(draw.node, drawn[0])
  assert.equal(models.drawsOf(loaded).rowed.length, 0, 'none of its own')
})

test('a model moved, or a node of it, has its rows written and sent once before the frame', () => {
  const models = createWorldModels(createWorldRanks())
  const { loaded, drawn } = model([{ meshes: 0 }])
  const scene = new Object3D()
  scene.add(loaded)
  scene.updateMatrixWorld(true)
  const [source] = models.drawsOf(loaded).rowed
  const poses = createWorldPoses(),
    sent: unknown[] = []
  const send = (rows: unknown, from: number, to: number) => void sent.push([rows, from, to])
  loaded.position.set(0, 0, 7)
  poses.moved(loaded)
  poses.apply(scene, new Map(), models, send)
  assert.deepEqual([...source.rows.matrices.slice(12, 15)], [0, 0, 7])
  assert.deepEqual(sent, [[source.rows, 0, 0]])
  drawn[0].position.set(1, 0, 0)
  poses.moved(loaded)
  poses.apply(scene, new Map(), models, send)
  assert.deepEqual([...source.rows.matrices.slice(12, 15)], [1, 0, 7])
  assert.equal(sent.length, 2)
})
