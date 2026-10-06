/**
 * A mesh costs what it holds (#874): its shape, its matter and how it reads them. The flag, the
 * morph weights and the listener live on the class or appear when used; the geometry and the
 * materials hear the mesh only while it is in a world.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { Mesh } from './mesh.ts'
import { Group } from './object3d.ts'
import { Geometry } from '../geometry/geometry.ts'
import { Material } from '../material/material.ts'
import { countingLink } from './sceneLink.fixture.ts'
import { Skeleton } from '../animation/skeleton.ts'
import { WaterSurface } from '../../fluids/waterSurface.ts'

test('mesh copies own morph state and material lists while sharing geometry, bones and waves', () => {
  const first = new Material('meshBasic'),
    second = new Material('meshBasic')
  const source = new Mesh(new Geometry(), [first, second])
  source.morphTargetInfluences = [0.25, 0.75]
  source.morphTargetDictionary = { smile: 0, frown: 1 }
  source.skeleton = new Skeleton([new Group()])
  source.waves = new WaterSurface({ level: 2, waves: [] })
  source.add(new Group())
  const copy = new Mesh()
  assert.equal(copy.copy(source), copy)
  assert.equal(copy.geometry, source.geometry)
  assert.deepEqual(copy.material, [first, second])
  assert.notEqual(copy.material, source.material)
  assert.equal(copy.skeleton, source.skeleton)
  assert.equal(copy.waves, source.waves)
  assert.equal(copy.children.length, 1)
  assert.notEqual(copy.children[0], source.children[0])
  assert.deepEqual(copy.morphTargetInfluences, [0.25, 0.75])
  assert.deepEqual(copy.morphTargetDictionary, { smile: 0, frown: 1 })
  copy.morphTargetInfluences![0] = 1
  copy.morphTargetDictionary!.smile = 9
  ;(copy.material as Material[]).pop()
  assert.deepEqual(source.morphTargetInfluences, [0.25, 0.75])
  assert.deepEqual(source.morphTargetDictionary, { smile: 0, frown: 1 })
  assert.equal((source.material as Material[]).length, 2)
  assert.equal(source.clone(false).children.length, 0)
})

test('copying a bare node keeps mesh content while taking its transform', () => {
  const destination = new Mesh()
  const geometry = destination.geometry,
    material = destination.material
  const source = new Group()
  source.position.set(2, 3, 4)
  assert.equal(destination.copy(source), destination)
  assert.deepEqual(destination.position.toArray(), [2, 3, 4])
  assert.equal(destination.geometry, geometry)
  assert.equal(destination.material, material)
})

test('absent optional deformation on a source leaves existing deformation untouched', () => {
  const destination = new Mesh()
  destination.morphTargetInfluences = [0.5]
  destination.morphTargetDictionary = { smile: 0 }
  destination.skeleton = new Skeleton([])
  destination.waves = new WaterSurface({ level: 1, waves: [] })
  const skeleton = destination.skeleton,
    waves = destination.waves
  destination.copy(new Mesh())
  assert.deepEqual(destination.morphTargetInfluences, [0.5])
  assert.deepEqual(destination.morphTargetDictionary, { smile: 0 })
  assert.equal(destination.skeleton, skeleton)
  assert.equal(destination.waves, waves)
})

test('copying different holders publishes both replacements to the linked world', () => {
  const source = new Mesh(),
    destination = new Mesh()
  const previousGeometry = destination.geometry
  const previousMaterial = destination.material as Material
  const { link, heard } = countingLink()
  destination._link = link
  destination.copy(source)
  assert.equal(destination.geometry, source.geometry)
  assert.equal(destination.material, source.material)
  assert.deepEqual(heard, [destination, destination])
  assert.equal(previousGeometry._listeners.size, 0)
  assert.equal(previousMaterial._listeners.size, 0)
})

test('copying identical holders avoids content notifications but still owns material lists', () => {
  const source = new Mesh(),
    destination = new Mesh(source.geometry, source.material)
  const { link, heard } = countingLink()
  destination._link = link
  destination.copy(source)
  assert.deepEqual(heard, [])
  source.material = [source.material as Material]
  destination.material = source.material
  heard.length = 0
  destination.copy(source)
  assert.notEqual(destination.material, source.material)
  assert.deepEqual(destination.material, source.material)
  assert.deepEqual(heard, [destination])
})
