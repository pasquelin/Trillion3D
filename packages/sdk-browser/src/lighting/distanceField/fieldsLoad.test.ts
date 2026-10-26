// The compiled meshes that have a field mark their pages; an HLOD cell's field names a cell, not a
// mesh, and marks none.
import test from 'node:test'
import assert from 'node:assert/strict'
import type { MeshDistanceField } from '../../../../sdk-core/src/lighting/distanceFieldFile.ts'
import { distanceFieldMeshes } from './fieldsLoad.ts'

const field = (mesh: number, hlodCell: boolean) => ({ mesh, hlodCell }) as MeshDistanceField

test('the meshes that have a field leave out the HLOD cells that do', () => {
  assert.equal(distanceFieldMeshes(undefined), undefined)
  assert.equal(distanceFieldMeshes([]), undefined)
  const fields = [field(0, false), field(3, true), field(5, false), field(0, true)]
  assert.deepEqual([...distanceFieldMeshes(fields)!], [0, 5], 'cell 3 is no mesh 3')
  assert.equal(distanceFieldMeshes([field(1, true)]), undefined, 'a cache of cells alone')
})
