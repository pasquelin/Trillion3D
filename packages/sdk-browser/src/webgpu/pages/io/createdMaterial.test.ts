// A material the page created, assigned to a drawable: its records point to it and every
// row is written again off it, in the variant the drawable's geometry asks for; what the open laid
// out for its forward pass is refused by name before any write.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../../host/graph/graph.fixture.ts'
import { webgpuPagesEngine } from '../pages.ts'
import { FLAG_HAS_COLOR, PAGE_INFO_STRIDE } from '../../../visibility/buffer.ts'
import { ROW_FLAGS_WORD, ROW_INDEX_WORDS } from '../../row/pageRow.ts'
import { installGpuGlobals } from '../../../../../../tests/kit/gpu/globals.ts'
import { mockGpu } from '../../../../../../tests/kit/gpu/mockGpu.ts'
import { quadScene, camera } from '../testScenes.fixture.ts'
import { createExplorerMaterialApi } from '../../../world/api/materialApi.ts'

/** The quad opened on WebGPU, its material API, and what its drawn rows say: colour, flags. */
function openQuad(edit: (fixture: ReturnType<typeof quadScene>) => void = () => {}) {
  installGpuGlobals()
  const fixture = quadScene(),
    { device, buffers } = mockGpu()
  edit(fixture)
  const backend = webgpuPagesEngine({
    ...fixture,
    gpuDevice: device,
    maxResidentPages: 4,
    viewport: [32, 32],
  })
  const api = createExplorerMaterialApi({
    check: () => {},
    ...fixture,
    engine: backend,
  })
  const rows = async () => {
    backend.render(camera())
    await backend.flush()
    backend.render(camera())
    const table = buffers.find((buffer) => buffer.label === 'Trillion3D page table')!
    const floats = new Float32Array(table.data.buffer, table.data.byteOffset, table.size / 4)
    const ints = new Uint32Array(floats.buffer, floats.byteOffset, floats.length)
    const words = PAGE_INFO_STRIDE / 4
    const bases = Array.from({ length: table.size / PAGE_INFO_STRIDE }, (_, row) => row * words)
    const drawn = bases.filter((base) => ints[base + ROW_INDEX_WORDS] > 0)
    assert.ok(drawn.length, 'the quad has rows')
    return {
      colours: new Set(drawn.map((base) => [...floats.subarray(base + 16, base + 19)].join())),
      coloured: drawn.every((base) => (ints[base + ROW_FLAGS_WORD] & FLAG_HAS_COLOR) !== 0),
    }
  }
  const close = () => {
    backend.dispose()
    fixture.geometry.dispose()
    fixture.material.dispose()
  }
  return { api, backend, rows, close }
}

const refused = (error: { code?: string }) => error.code === 'MATERIAL_CLASS_CHANGE'

test('WebGPU rows draw a drawable in the material the page created and assigned it', async () => {
  const { api, backend, rows, close } = openQuad()
  try {
    await backend.prepare()
    assert.deepEqual((await rows()).colours, new Set(['1,0,0']))
    const blended = api.createMaterial({ alphaMode: 'blend', opacity: 0.5 }).id
    assert.throws(() => api.assignMaterial('0/0', blended), refused)
    const made = api.createMaterial({ baseColor: [0, 0.5, 1] })
    assert.equal(api.assignMaterial('0/0', made.id), true)
    assert.deepEqual(
      (await rows()).colours,
      new Set(['0,0.5,1']),
      'every row, off the created surface',
    )
  } finally {
    close()
  }
})

test('a vertex-coloured drawable keeps its colours on WebGPU with a created material', async () => {
  const { api, backend, rows, close } = openQuad(({ geometry, material }) => {
    geometry.setAttribute('color', G.floatAttribute(new Array(12).fill(1), 3))
    material.vertexColors = true // the variant the open gives a coloured geometry
  })
  try {
    await backend.prepare()
    assert.equal((await rows()).coloured, true)
    const made = api.createMaterial({ baseColor: [0, 0.5, 1] })
    assert.equal(api.assignMaterial('0/0', made.id), true)
    assert.equal((await rows()).coloured, true, 'its rows still read its colours')
    api.setMaterial(made.id, { baseColor: [0, 1, 0] })
    assert.deepEqual(
      (await rows()).colours,
      new Set(['0,1,0']),
      'the coloured variant follows a write',
    )
  } finally {
    close()
  }
})

test('a drawable the open laid out as a forward copy is refused another surface by name', async () => {
  const { api, backend, close } = openQuad(({ metadata, material }) => {
    metadata.primitives[0].pass = 'shared-blend'
    material.transparent = true
  })
  try {
    await backend.prepare()
    const made = api.createMaterial({ alphaMode: 'blend', opacity: 0.5 }).id
    assert.throws(
      () => api.assignMaterial('0/0', made),
      (error: { code?: string; message: string }) =>
        refused(error) && /forward copy/.test(error.message),
    )
  } finally {
    close()
  }
})
