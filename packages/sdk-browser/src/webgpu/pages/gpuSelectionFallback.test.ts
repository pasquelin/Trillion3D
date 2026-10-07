import test from 'node:test'
import { MANIFEST_IDENTITY } from '../../engine/pagesEngine.fixture.ts'
import { triangleGeometry } from '../../engine/pagesEngineScenes.fixture.ts'
import assert from 'node:assert/strict'
import * as G from '../../host/graph/graph.fixture.ts'
import { compareImages, type ClusterManifest } from '../../../../sdk-core/src/index.ts'
import { webgpuPagesEngine } from './pages.ts'
import { collectClusterPages } from '../../page/selection/selection.ts'
import { packDagSelection } from '../../gpu/dag/selection.ts'
import {
  backendRasterRgba,
  backendVisibilityIds,
} from '../../../../../bench/oracles/browser/cpu-image/backendImage.ts'
import { shadeVisibility } from '../../../../../bench/oracles/browser/cpu-image/shade.ts'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'
import { mockGpu } from '../../../../../tests/kit/gpu/mockGpu.ts'
import { quadScene, camera, rootPage, twoPrimitives } from './testScenes.fixture.ts'
import { engineCamera } from '../../camera/camera.fixture.ts'
import { surfaceOf } from '../../page/surface.ts'
import { rasterVisibilityIds } from '../../../../../bench/oracles/browser/cpu-image/raster.ts'

test('GPU page ids skip a non-hierarchy primitive that sits first in allPages', async () => {
  installGpuGlobals()
  const geoA = triangleGeometry([-1, -1, 0, 1, -1, 0, 1, 1, 0])
  const geoB = triangleGeometry([8, -1, 0, 10, -1, 0, 10, 1, 0])
  const material = G.basicSurface(),
    meshA = G.mesh(geoA, material),
    meshB = G.mesh(geoB, material),
    source = new G.Group()
  source.add(meshA, meshB)
  const {
    metadata: metadataPartial,
    indices,
    associations,
  } = twoPrimitives(
    meshA,
    meshB,
    rootPage('orphan', [-1, -1, 0], [1, 1, 0]),
    rootPage('exact', [8, -1, 0], [10, 1, 0]),
  )
  const metadata: ClusterManifest = { ...metadataPartial, ...MANIFEST_IDENTITY }
  const collected = collectClusterPages(source, metadata, indices, associations)
  const packed = packDagSelection(collected.roots)
  const { device } = mockGpu({ packed })
  const viewport: [number, number] = [32, 32]
  const backend = webgpuPagesEngine({
    source,
    metadata,
    indices,
    associations,
    gpuDevice: device,
    maxResidentPages: 4,
    viewport,
  })
  const cam = G.perspectiveCamera(55, 1, 0.1, 100)
  cam.position.set(9, 0, 5)
  cam.lookAt(9, 0, 0)
  cam.updateMatrixWorld()
  await backend.prepare()
  backend.render(cam)
  await backend.flush()
  backend.render(cam)
  assert.deepEqual(backend.selectedPageIds(), ['exact'])
  backend.dispose()
  geoA.dispose()
  geoB.dispose()
  material.dispose()
})

// #1483: a mapping the device refuses reads nothing and is copied again; only `device.lost` says
// the device is lost, never a readback.
test('a failed GPU selection readback keeps the device: the cut is read again', async () => {
  installGpuGlobals()
  const { source, metadata, indices, associations, geometry, material } = quadScene()
  const collected = collectClusterPages(source, metadata, indices, associations)
  const packed = packDagSelection(collected.roots)
  const { device } = mockGpu({ packed, failMap: true })
  const backend = webgpuPagesEngine({
    source,
    metadata,
    indices,
    associations,
    gpuDevice: device,
    maxResidentPages: 2,
    viewport: [32, 32],
  })
  await backend.prepare()
  backend.render(camera())
  await backend.flush({ image: false })
  assert.doesNotThrow(() => backend.render(camera()), 'no lost device')
  backend.dispose()
  geometry.dispose()
  material.dispose()
})

test('webgpu visbuffer ids match the CPU oracle for a stable pose', async () => {
  installGpuGlobals()
  const { device, textures } = mockGpu()
  const { source, metadata, indices, associations, geometry, material } = quadScene()
  const backend = webgpuPagesEngine({
    source,
    metadata,
    indices,
    associations,
    gpuDevice: device,
    maxResidentPages: 2,
    viewport: [32, 32],
  })
  const cam = camera()
  await backend.prepare()
  backend.render(cam)
  await backend.flush()
  backend.render(cam)
  const mesh = source.children[0] as G.HostMesh
  const pages = [
    {
      array: indices.get('0')!,
      attributes: geometry.attributes,
      material: surfaceOf(material),
    },
    {
      array: indices.get('1')!,
      attributes: geometry.attributes,
      material: surfaceOf(material),
    },
  ]
  const roots = [{ world: mesh.matrixWorld }],
    locations = {
      roots,
      packed: pages.map((_, i) => i),
      rootOfPacked: new Int32Array(pages.length),
    }
  const expected = rasterVisibilityIds(pages, locations, engineCamera(cam), [32, 32])
  const observed = backendVisibilityIds(backend.rasterView())
  assert.deepEqual(observed, expected)
  assert.deepEqual(observed, backendVisibilityIds(backend.rasterView()))
  const image = compareImages(
    backendRasterRgba(backend.rasterView()),
    shadeVisibility(expected, pages, locations, engineCamera(cam), [32, 32]),
  )
  assert.equal(image.maxChannelError, 0)
  // No map: no colour pool is allocated, the white fill reads the stand-in.
  assert.equal(
    textures.find((t) => t.format === 'rgba8unorm-srgb'),
    undefined,
  )
  backend.dispose()
  geometry.dispose()
  material.dispose()
})
