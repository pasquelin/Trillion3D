import test from 'node:test'
import assert from 'node:assert/strict'
import type {
  PreparedSceneTables,
  TableNode,
} from '../../../../sdk-core/src/scene/core/tableContracts.ts'
import type { TableDocument } from '../../../../sdk-core/src/scene/core/tableDocuments.ts'
import { BufferAttribute } from '../../../../sdk-core/src/world/buffer/attribute.ts'
import { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts'
import { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts'
import { animation } from '../../../../sdk-core/src/world/animation/family.ts'
import { GraphSurface } from '../graph/surface.ts'
import { preparedGraph } from './graph.ts'

const node = (fields: Partial<TableNode>): TableNode => ({
  ...{ name: '', children: [], mesh: null, light: null, camera: null, skin: null },
  ...{ weights: null, matrix: null, translation: null, rotation: null, scale: null },
  visible: true,
  ...fields,
})

test('a skinned node bends by its skin, and a clip moves a joint the file left unnamed', async () => {
  const tables = {
    scene: { name: '', nodes: [0, 1] },
    nodes: [
      node({ name: 'body', mesh: 0, skin: 0 }),
      node({ name: 'hip', children: [2] }),
      node({}),
    ],
    skins: [{ name: '', joints: [1, 2], skeleton: 1, inverseBindMatrices: null }],
    animations: [
      {
        name: 'bend',
        channels: [
          {
            node: 2,
            path: 'rotation',
            interpolation: 'LINEAR',
            times: [0, 1],
            values: [0, 0, 0, 1, 0, 0, 1, 0],
          },
        ],
      },
    ],
  } as unknown as PreparedSceneTables
  const meshes = [{ name: 'body', weights: null, primitives: [{ material: 0 }] }]
  const geometryOf = () => {
    const geometry = new Geometry()
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(9), 3))
    return geometry
  }
  const { scene, nodes, clips } = await preparedGraph({
    tables,
    meshes: meshes as unknown as TableDocument['meshes'],
    geometryOf,
    materialOf: () => Promise.resolve(new GraphSurface('standard')),
  })
  const body = nodes[0] as unknown as Mesh
  assert.ok(body instanceof Mesh)
  assert.deepEqual(body.skeleton?.bones, [nodes[1], nodes[2]])
  assert.equal(nodes[2].name, 'node_2')
  assert.equal(clips[0].name, 'bend')
  const mixer = animation.createMixer(scene)
  mixer.clipAction(clips[0]).play()
  mixer.update(0.25)
  assert.ok(Math.abs(nodes[2].quaternion.z - Math.sin(Math.PI / 8)) < 1e-6)
})
