import test from 'node:test'
import assert from 'node:assert/strict'
import { createTestContext } from '../core/testContext.fixture.ts'
import { WebglClusterRenderer } from './renderer.ts'
import { readDegraded } from './validation.ts'
import { createHostDrawCamera } from '../../camera/world.ts'
import * as G from '../../host/graph/graph.fixture.ts'
import type { WholeMesh } from '../../cluster/batchMesh.ts'
import { clusterWebglCompatibility } from '../../../../../bench/witnesses/exact/clusterCompatibility.ts'

test('WebGL reflection captures leave with the last screen-traced receiver: a matte one reads the environment', () => {
  const context = createTestContext({ answers: { getExtension: () => ({}) } }),
    renderer = new WebglClusterRenderer(
      context.gl,
      readDegraded(() => {}),
    )
  const material = new G.GraphSurface('standard', { roughness: 0, metalness: 1 })
  const geometry = new G.Geometry().setIndex(new G.BufferAttribute(new Uint32Array([0, 1, 2]), 1))
  geometry.setAttribute('position', new G.BufferAttribute(new Float32Array(9), 3))
  geometry.setAttribute('normal', new G.BufferAttribute(new Float32Array(9), 3))
  const mesh = new G.Mesh(geometry, material) as unknown as WholeMesh
  const draw = () => renderer.draw([], { lights: [] }, createHostDrawCamera(), true, true, [mesh])
  draw()
  assert.equal(renderer.backdropPasses, 1)
  assert.equal(renderer.backdropSubmissions, 1)
  // Capture, the reduced resolve and the main pass: the mirror receiver is drawn once more.
  assert.equal(renderer.resolvePasses, 1)
  assert.equal(renderer.triangles, 3)
  const sourceBytes = 8 * 4 * 12 + (4 * 2 + 2 * 1 + 1) * (8 + 8)
  const resolveBytes = 8 * 4 * 12
  assert.equal(
    renderer.backdropBytes,
    sourceBytes + resolveBytes,
    'base color/depth, radiance/bounds mip levels and the reduced resolve',
  )
  material.roughness = 1
  material.needsUpdate = true
  draw()
  // A matte-only view allocates no reflection target and runs no reflection pass (#1341).
  assert.equal(renderer.backdropPasses, 0, 'a rough receiver captures nothing')
  assert.equal(renderer.resolvePasses, 0, 'a rough receiver resolves nothing')
  assert.equal(renderer.backdropBytes, 0)
  assert.equal(renderer.triangles, 1)
  material.roughness = 0.2
  material.needsUpdate = true
  draw()
  assert.equal(renderer.backdropPasses, 1, 'polished metal keeps its screen trace')
  assert.equal(renderer.resolvePasses, 0)
  assert.equal(renderer.backdropBytes, sourceBytes)
  renderer.dispose()
})

test('a mirror missing half-float support is refused before drawing with a reflection-specific reason', () => {
  const context = createTestContext(),
    material = new G.GraphSurface('standard', { roughness: 0 })
  const copy = {
    material,
    geometry: {
      attributes: {
        position: new G.BufferAttribute(new Float32Array(9), 3),
        normal: new G.BufferAttribute(new Float32Array(9), 3),
      },
    },
  }
  assert.match(
    clusterWebglCompatibility(context.gl, [], [copy], { lights: [] })!,
    /reflections needs a half-float/,
  )
  // A matte receiver reads the environment: no capture, so no half-float needed (#1341).
  material.roughness = 1
  material.needsUpdate = true
  assert.equal(clusterWebglCompatibility(context.gl, [], [copy], { lights: [] }), undefined)
})
