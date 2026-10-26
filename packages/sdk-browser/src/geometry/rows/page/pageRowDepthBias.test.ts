import test from 'node:test'
import assert from 'node:assert/strict'
import { webgpuPagesEngine } from '../../../frame/backend/pages.ts'
import { PAGE_INFO_STRIDE, ROW_WORDS } from '../../../visibility/types.ts'
import { installGpuGlobals } from '../../../../../../tests/kit/fakeDevice/globals.ts'
import { BACKEND } from '../../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { fakeDevice } from '../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { quadScene, camera } from '../../../frame/backend/testScenes.fixture.ts'
import { depthLayerUnits } from '../../../../../sdk-core/src/lod/depthLayer.ts'
import { PAGE_INFO } from '../../../visibility/pageInfo.ts'
import { createTextureCaches } from '../../../materials/texture/textureCaches.ts'
import { createPageCache } from '../../streaming/pageCache.ts'

// Behaviour 22: the cluster's record carries the bias in positive units, which the decode puts at
// the decoded cluster's depthBias word; a layer-0 cluster keeps that field at zero.
test('a cluster record carries the layer bias in positive units at the decoded depthBias word', async () => {
  installGpuGlobals()
  const scene = quadScene()
  // The quad's second cluster carries the layer the coplanar step would have assigned; the first
  // stays at layer 0 (a missing field equals 0, as decoding leaves it).
  ;(scene.metadata.primitives[0].pages[1] as { depthLayer?: number }).depthLayer = 5
  const { device, buffers } = fakeDevice(BACKEND)
  const backend = webgpuPagesEngine({
    textureCaches: createTextureCaches(createPageCache()),
    ...scene,
    gpuDevice: device,
    maxResidentPages: 4,
    viewport: [32, 32],
  })
  const view = camera()
  try {
    await backend.prepare()
    backend.render(view)
    await backend.flush?.()
    const table = buffers.findLast((buffer) => buffer.label === 'Trillion3D decoded clusters')
    assert.ok(table, 'the decoded clusters are allocated')
    const rows = new Uint32Array(
      table!.data.buffer,
      table!.data.byteOffset,
      table!.data.byteLength / 4,
    )
    let sawPositiveBias = false,
      sawZeroBias = false
    for (let row = 0; row < table!.size / PAGE_INFO_STRIDE; row++) {
      const base = row * ROW_WORDS,
        indexCount = rows[base + PAGE_INFO.at.indexCount]
      if (!indexCount) continue
      const bias = rows[base + PAGE_INFO.at.depthBias]
      if (bias === 0) {
        sawZeroBias = true
        continue
      }
      assert.equal(bias, depthLayerUnits(5), 'depthBias equals the layer units')
      assert.ok(bias > 0, 'the bias is in positive units')
      sawPositiveBias = true
    }
    assert.ok(sawPositiveBias, 'the layered cluster carries a positive depthBias')
    assert.ok(sawZeroBias, 'the untouched cluster kept depthBias at zero')
  } finally {
    await backend.dispose()
    scene.geometry.dispose()
    scene.material.dispose()
  }
})
