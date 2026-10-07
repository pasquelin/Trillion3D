import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../host/graph/graph.fixture.ts'
import { webgpuPagesEngine } from './pages.ts'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'
import { mockGpu } from '../../../../../tests/kit/gpu/mockGpu.ts'
import { dagRoots } from '../../engine/pagesEngine.fixture.ts'
import { camera } from './testScenes.fixture.ts'

test('the initial cover also protects regions first discovered after a camera jump', async () => {
  installGpuGlobals()
  const { device } = mockGpu({
    limits: { maxBufferSize: 1 << 24, maxStorageBufferBindingSize: 1 << 24 },
  })
  const geometry = new G.Geometry()
  geometry.setAttribute(
    'position',
    G.floatAttribute(
      [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0, 100, -1, 0, 102, -1, 0, 102, 1, 0],
      3,
    ),
  )
  geometry.setIndex(G.indices([0, 1, 2, 0, 2, 3, 4, 5, 6]))
  const material = G.basicSurface(),
    mesh = G.mesh(geometry, material),
    source = new G.Group()
  source.add(mesh)
  const pages = dagRoots([
    {
      id: 0,
      url: '0',
      count: 3,
      min: [-1, -1, 0] as number[],
      max: [1, 1, 0] as number[],
      bytes: 12,
      sha256: 'x',
    },
    {
      id: 1,
      url: '1',
      count: 3,
      min: [-1, -1, 0] as number[],
      max: [1, 1, 0] as number[],
      bytes: 12,
      sha256: 'x',
    },
    {
      id: 2,
      url: '2',
      count: 3,
      min: [100, -1, 0] as number[],
      max: [102, 1, 0] as number[],
      bytes: 12,
      sha256: 'x',
    },
  ]).pages
  const metadata = {
    errorModel: 'dag-group-qem-v3',
    clusterStrategy: 'dag-groups',
    schema: 1,
    status: 'ready',
    key: 'k',
    scope: 'full' as const,
    sourceTriangles: 0,
    selectedTriangles: 0,
    selectedNodes: 0,
    totalNodes: 0,
    primitives: [
      {
        mesh: 0,
        primitive: 0,
        pass: 'exact-clusters',
        pages,
        structure: { version: 1, roots: [0, 1, 2], groups: [] },
      },
    ],
  }
  const indices = new Map([
    ['0', new Uint32Array([0, 1, 2])],
    ['1', new Uint32Array([0, 2, 3])],
    ['2', new Uint32Array([4, 5, 6])],
  ])
  const backend = webgpuPagesEngine({
    source,
    metadata,
    indices,
    associations: new Map([[mesh, { meshes: 0, primitives: 0 }]]),
    gpuDevice: device,
    maxResidentPages: 3,
    viewport: [32, 32],
  })
  await backend.prepare()
  const cam = camera()
  backend.render(cam)
  await backend.flush()
  backend.render(cam)
  // The GPU cut, the engine's one cut (#1483), has no host frustum test before its first readback:
  // the whole root cover is resident at the first image, the region off the view included.
  const first = backend.metrics().residentPages
  assert.equal(first, 3)
  cam.position.set(101, 0, 5)
  cam.lookAt(101, 0, 0)
  cam.updateMatrixWorld()
  backend.render(cam)
  await backend.flush()
  backend.render(cam)
  // The region first seen after the jump was covered before it: nothing loaded, nothing evicted.
  assert.equal(backend.metrics().residentPages, first)
  assert.equal(backend.metrics().cacheEvictions, 0)
  assert.equal(backend.overBudget, false)
  backend.dispose()
  geometry.dispose()
  material.dispose()
})
