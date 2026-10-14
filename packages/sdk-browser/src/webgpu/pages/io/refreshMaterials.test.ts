// A surface the host rewrites in place (`setMaterial`) reaches its one record in the material table
// at the values refresh, which its rows and items name: an opaque one's colour writes that record
// alone, no row; a move between opaque and masked writes its rows again.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Matrix4 } from '../../../../../sdk-core/src/world/math/matrix4.ts'
import { webgpuPagesEngine } from '../pages.ts'
import { refreshWebgpuMaterials } from './refreshMaterials.ts'
import {
  FLAG_MASK,
  MATERIAL_RANK_MASK,
  PAGE_INFO_STRIDE,
  ROW_WORDS,
} from '../../../visibility/types.ts'
import { MATERIAL_RECORD, MATERIAL_RECORD_WORDS } from '../../material/materialLayout.ts'
import { BLEND_ITEM_SHIPPED } from '../../blend/itemLayout.fixture.ts'
import { installGpuGlobals } from '../../../../../../tests/kit/gpu/globals.ts'
import { BACKEND, writtenBytes } from '../../../../../../tests/kit/gpu/fakeRecords.ts'
import { fakeDevice } from '../../../../../../tests/kit/gpu/fakeDevice.ts'
import { quadScene, camera } from '../testScenes.fixture.ts'
import { surfaceOf } from '../../../page/surface.ts'
import { PAGE_INFO } from '../../../visibility/pageInfo.ts'
import { surfaceWritten } from '../../../page/surfaceWrites.ts'
import { ROW_NAMED, ROW_STALES } from '../../../placement/rowWordsWgsl.ts'
import { targetsTaken } from '../../../placement/rowTargets.ts'

/** The records the material table sent up last (`Trillion3D material records`). */
const lastRecords = (textureWrites: ReturnType<typeof fakeDevice>['textureWrites']) =>
  textureWrites.findLast(
    ({ destination }) =>
      (destination.texture as { label?: string }).label === 'Trillion3D material records',
  )!

test('a blended surface rewritten in place reaches its record at the values refresh', async () => {
  installGpuGlobals()
  const fixture = quadScene(),
    { device, writes, textureWrites } = fakeDevice(BACKEND)
  fixture.metadata.primitives[0].pass = 'shared-blend'
  fixture.material.transparent = true
  fixture.material.opacity = 0.5
  const backend = webgpuPagesEngine({
    ...fixture,
    gpuDevice: device,
    maxResidentPages: 2,
    viewport: [32, 32],
  })
  /** The colour and opacity of the record the item names (its material word, `BlendItem.material`). */
  const rgba = () => {
    const last = writes.filter((w) => w.buffer.label === 'Trillion3D blend item records').at(-1)!
    const rank =
      new Uint32Array(writtenBytes(last).slice().buffer)[BLEND_ITEM_SHIPPED.at.material] &
      MATERIAL_RANK_MASK
    const words = new Float32Array(lastRecords(textureWrites).data.buffer as ArrayBuffer),
      at = rank * MATERIAL_RECORD_WORDS + MATERIAL_RECORD.at.baseColor
    return [...words.subarray(at, at + 3), words[at + 3]]
  }
  try {
    await backend.prepare()
    backend.render(camera())
    assert.deepEqual(rgba(), [1, 0, 0, 0.5])
    fixture.material.baseColor = [0, 0.5, 1]
    fixture.material.opacity = 0.25
    surfaceWritten(fixture.material)
    backend.refreshMaterials?.(true)
    backend.render(camera())
    assert.deepEqual(rgba(), [0, 0.5, 1, 0.25])
  } finally {
    backend.dispose()
    fixture.geometry.dispose()
    fixture.material.dispose()
  }
})

// A colour is a value of the record alone: the table writes the surface's one record (ten texels),
// and the rows that name it, which hold none of its values, are not written again.
test('an opaque colour rewritten in place writes its one record and no row', async () => {
  installGpuGlobals()
  const fixture = quadScene(),
    { device, writes, textureWrites } = fakeDevice(BACKEND)
  const backend = webgpuPagesEngine({
    ...fixture,
    gpuDevice: device,
    maxResidentPages: 4,
    viewport: [32, 32],
  })
  const rowWrites = () => writes.filter((w) => w.buffer.label === 'Trillion3D page table').length
  try {
    await backend.prepare()
    backend.render(camera())
    await backend.flush()
    backend.render(camera())
    const [rows, records] = [rowWrites(), textureWrites.length]
    fixture.material.baseColor = [0.25, 0.5, 0.75]
    surfaceWritten(fixture.material)
    backend.refreshMaterials?.(true)
    backend.render(camera())
    assert.equal(rowWrites(), rows, 'no row written')
    const sent = textureWrites
      .slice(records)
      .filter(
        ({ destination }) =>
          (destination.texture as { label?: string }).label === 'Trillion3D material records',
      )
    assert.equal(sent.length, 1, 'one write of the table')
    assert.deepEqual(sent[0].size, [MATERIAL_RECORD_WORDS / 4, 1, 1], 'of one record, one layer')
  } finally {
    backend.dispose()
    fixture.geometry.dispose()
    fixture.material.dispose()
  }
})

// A material moved between opaque and masked inside the session: the visibility passes
// draw both, told apart by the row's cutout flag.
test('an opaque surface turned masked cuts every row of its material', async () => {
  installGpuGlobals()
  const fixture = quadScene(),
    { device, buffers } = fakeDevice(BACKEND)
  const backend = webgpuPagesEngine({
    ...fixture,
    gpuDevice: device,
    maxResidentPages: 4,
    viewport: [32, 32],
  })
  const masked = () => {
    const table = buffers.find((buffer) => buffer.label === 'Trillion3D page table')!
    const ints = new Uint32Array(table.data.buffer, table.data.byteOffset, table.size / 4)
    const rows = Array.from({ length: table.size / PAGE_INFO_STRIDE }, (_, row) => row * ROW_WORDS)
    const drawn = rows.filter((base) => ints[base + PAGE_INFO.at.indexCount] > 0)
    assert.ok(drawn.length, 'the quad has rows')
    return drawn.every((base) => (ints[base + PAGE_INFO.at.flags] & FLAG_MASK) !== 0)
  }
  try {
    await backend.prepare()
    backend.render(camera())
    assert.equal(masked(), false)
    fixture.material.alphaTest = 0.5
    surfaceWritten(fixture.material)
    backend.refreshMaterials?.(true, { surfaces: [fixture.material], from: 'opaque', to: 'mask' })
    // The masked class is asked at the next frame entry, the image held until it compiled.
    backend.render(camera())
    await backend.flush()
    assert.equal(masked(), true, 'every row of the material cuts at its cutoff')
  } finally {
    backend.dispose()
    fixture.geometry.dispose()
    fixture.material.dispose()
  }
})

// A cutoff moved in place under a casting light drew a few shadowed pixels off the image of a
// session opened on it: its redrawn shadow pages land in other pool slots, and a shadow read
// depended on the slot. Read texel-exact wherever a page lies, they draw that session's
// image: the move is taken in place, the shadow over its rows drawn again — its row named to the
// rows pass, which stales the box of the sphere it holds (`ROW_STALES`, `staleRow`). No box is
// made on the CPU.
test('an alpha move is taken in place under a casting light, the shadow over its rows drawn again', () => {
  const { material } = quadScene()
  const worlds: number[][] = []
  const staled = ({ targets, count } = runtime.rowWords!) =>
    [...targets.subarray(0, count)].filter((word) => word & ROW_STALES).map((w) => w & ROW_NAMED)
  const cutout = {
    material: surfaceOf(material),
    min: [-1, -1, 0],
    max: [1, 1, 0],
  }
  const runtime = {
    lights: {
      store: { count: 1 },
      casts: {},
      mobility: { moves: () => false },
      changes: { worldChanged: (min: number[], max: number[]) => worlds.push([...min, ...max]) },
    },
    layout: {
      rows: {
        tableEpoch: 1,
        rowCount: 1,
        blendFirst: 1,
        casterSlots: 1,
        pageTableInts: new Uint32Array(ROW_WORDS),
        packedRecs: [cutout],
        packedPageIndex: new Int32Array([0]),
      },
      selectionRoots: [{ world: new Matrix4() }],
      placement: {
        baseOfRoot: Int32Array.from([0]),
        packedCount: 1,
      },
    },
    run: { gate: { movedInPlace() {} } },
    vis: {},
  } as unknown as Parameters<typeof refreshWebgpuMaterials>[0]
  const alpha = { surfaces: [material], from: 'mask', to: 'mask' } as const
  assert.equal(refreshWebgpuMaterials(runtime, true, alpha), true, 'no new session')
  assert.deepEqual(staled(), [0], 'the shadow pages over the cutout drawn again')
  assert.equal(worlds.length, 0, 'from the sphere the GPU holds: no box made on the CPU')
  // The rows pass took the rows named.
  targetsTaken(runtime.rowWords!, {} as GPUCommandEncoder)
  assert.equal(refreshWebgpuMaterials(runtime, true), true, 'values alone stay in place')
  assert.deepEqual([staled(), worlds.length], [[], 0], 'and stale no shadow')
})
