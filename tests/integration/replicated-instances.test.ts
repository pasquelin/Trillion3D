import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import { replicateInstances } from '../../packages/sdk-browser/src/scene/replicateInstances.ts'
test('1/4/9/12 replicas share assets, preserve associations and extend real bounds', () => {
  const counts: readonly (1 | 4 | 9 | 12)[] = [1, 4, 9, 12]
  for (const count of counts) {
    const source = new G.Group(),
      geometry = G.boxGeometry(2, 1, 3),
      material = G.basicSurface(),
      mesh = G.mesh(geometry, material)
    source.add(mesh)
    const associations: Map<G.Object3D, { meshes: number; primitives: number }> = new Map([
        [mesh, { meshes: 7, primitives: 0 }],
      ]),
      grid = replicateInstances(source, associations, count),
      meshes: G.HostMesh[] = []
    grid.traverse((o) => {
      if (o instanceof G.Mesh && !(o instanceof G.InstancedMesh)) meshes.push(o as G.HostMesh)
    })
    assert.equal(meshes.length, count)
    for (const copy of meshes) {
      assert.equal(copy.geometry, geometry)
      assert.equal(copy.material, material)
      assert.deepEqual(associations.get(copy), { meshes: 7, primitives: 0 })
    }
    const size = new G.Box3().setFromObject(grid).getSize(new G.Vector3()),
      columns = count === 12 ? 4 : Math.sqrt(count),
      rows = count === 12 ? 3 : Math.sqrt(count)
    assert.equal(size.x, 2 * columns)
    assert.equal(size.z, 3 * rows)
    geometry.dispose()
    material.dispose()
  }
})
