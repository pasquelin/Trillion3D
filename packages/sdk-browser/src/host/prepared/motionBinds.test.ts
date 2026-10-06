import test from 'node:test'
import assert from 'node:assert/strict'
import type { PreparedSceneTables } from '../../../../sdk-core/src/scene/core/tableContracts.ts'
import { Skeleton } from '../../../../sdk-core/src/world/animation/skeleton.ts'
import { Matrix4 } from '../../../../sdk-core/src/world/math/matrix4.ts'
import { object } from '../../../../sdk-core/src/world/object/index.ts'
import { geometry } from '../../../../sdk-core/src/world/geometry/index.ts'
import { material } from '../../../../sdk-core/src/world/material/index.ts'
import { bindSkins } from './motion.ts'

test('imported absent inverse binds are identities for every joint; authored rigs still auto-bind', () => {
  const mesh = object.mesh(geometry.box(1, 1, 1), material.meshBasic())
  const bones = [object.group(), object.group()]
  bones.forEach((bone, i) => {
    bone.position.x = 5 + i
    bone.updateMatrixWorld(true)
  })
  mesh.updateMatrixWorld(true)
  const tables = {
    skins: [{ joints: [1, 2], inverseBindMatrices: null }],
    nodes: [{ skin: 0 }, { skin: null }, { skin: null }],
  } as unknown as PreparedSceneTables
  bindSkins(tables, [mesh, ...bones])
  const imported = mesh.skeleton!
  assert.deepEqual(
    Array.from(imported.boneInverses),
    bones.flatMap(() => new Matrix4().toArray()),
  )
  const palette = imported.palette(mesh.matrixWorld.elements, new Float32Array(24))
  assert.equal(palette[3], 5)
  assert.equal(palette[15], 6)
  const authored = new Skeleton(bones)
  const authoredPalette = authored.palette(mesh.matrixWorld.elements, new Float32Array(24))
  assert.equal(authoredPalette[3], 0)
  assert.equal(authoredPalette[15], 0)
})

test('imported explicit inverse bind matrices keep their supplied transform', () => {
  const mesh = object.mesh(geometry.box(1, 1, 1), material.meshBasic())
  const bone = object.group()
  bone.position.x = 5
  bone.updateMatrixWorld(true)
  mesh.updateMatrixWorld(true)
  const inverse = new Matrix4().toArray()
  inverse[12] = -2
  bindSkins(
    {
      skins: [{ joints: [1], inverseBindMatrices: inverse }],
      nodes: [{ skin: 0 }, { skin: null }],
    } as unknown as PreparedSceneTables,
    [mesh, bone],
  )
  const palette = mesh.skeleton!.palette(mesh.matrixWorld.elements, new Float32Array(12))
  assert.equal(palette[3], 3)
})
