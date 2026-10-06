import test from 'node:test'
import assert from 'node:assert/strict'
import { animation } from '../../../../sdk-core/src/world/animation/family.ts'
import { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts'
import { Group } from '../../../../sdk-core/src/world/object/object3d.ts'
import { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts'
import { BufferAttribute } from '../../../../sdk-core/src/world/buffer/attribute.ts'
import { LoadedModel, type ModelRecord } from './loadedModel.ts'
import { clipsOf } from '../../host/prepared/motion.ts'
import type { PreparedSceneTables } from '../../../../sdk-core/src/scene/core/tableContracts.ts'
import { createDeformationFrame } from '../../deformation/frame.ts'
import { deformedOf } from '../../deformation/source.ts'
import { recordLayout } from '../../deformation/layout.ts'

test('a compiled morph clip writes the exact weights the GPU placement uploads', () => {
  const geometry = new Geometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(9), 3))
  geometry.morphAttributes.position = [new BufferAttribute(new Float32Array(9), 3)]
  const mesh = new Mesh(geometry)
  mesh.name = 'AnimatedMorphCube'
  const source = new Group().add(mesh)
  const tables = {
    animations: [
      {
        name: 'morph',
        channels: [
          { node: 0, path: 'weights', interpolation: 'LINEAR', times: [0, 1], values: [0, 1] },
        ],
      },
    ],
  } as unknown as PreparedSceneTables
  const clips = clipsOf(tables, [mesh])
  const model = new LoadedModel({
    scene: { source, nodes: [mesh], clips },
  } as unknown as ModelRecord)
  const placed = deformedOf(mesh, { deformation: { joints: [], targets: [1] } }, mesh.matrixWorld)!
  const frame = createDeformationFrame([placed])
  frame.update(() => false)
  animation.createMixer(model).clipAction(model.animations[0]).seek(0.5)
  assert.equal(mesh.morphTargetInfluences![0], 0.5)
  assert.equal(frame.pending(), true)
  assert.equal(
    frame.update(() => false),
    true,
  )
  const at = recordLayout(placed.shape).weights
  assert.deepEqual([...frame.block.slice(at, at + 2)], [0.5, 0])
})
