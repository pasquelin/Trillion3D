// The run-time proxy kept to the placements it traces: an instance a placement, a surface a material,
// a cut's columns once however many placements wear it — written as the culling's rows are, appended,
// parked, marked —, and no buffer while none wears one. Over the device double.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fieldCamera, placementField } from './placementTree.fixture.ts'
import { kernelUniforms } from './selectionHelpers.fixture.ts'
import { createGpuDagSelection, packDagSelection } from './selection.ts'
import { dagRootCounts } from './pack.ts'
import { mockGpu } from '../../../../../tests/kit/gpu/mockGpu.ts'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'
import type { RuntimeCutProxy } from '../../../../sdk-core/src/contracts/proxy.ts'
import type { PageSurface } from '../../page/surface.ts'
import {
  INSTANCE,
  INSTANCE_WORDS,
  RUNTIME_HEADER,
  RUNTIME_HEADER_WORDS,
  RUNTIME_NONE,
} from '../../bounce/runtimeLayout.ts'

const LIMITS = {
  maxBufferSize: 1 << 28,
  maxStorageBufferBindingSize: 1 << 28,
  maxStorageBuffersPerShaderStage: 16,
}
const LABEL = 'Trillion3D run-time proxy'

/** A cut of `triangles` triangles over `nodes` nodes, columns of a known value. */
const cut = (triangles: number, nodes: number, value: number): RuntimeCutProxy => ({
  triangles: new Float32Array(triangles * 9).fill(value),
  albedo: new Uint32Array(triangles).fill(0xffffffff),
  nodeBounds: new Float32Array(nodes * 6).fill(value),
  nodeChildren: new Uint32Array(nodes * 12).fill(7),
  cellMetres: 0.1,
})
const surface = (emissive: number, version = 1): PageSurface =>
  ({
    baseColor: [1, 0.5, 0.25],
    metalness: 0,
    lit: true,
    emissive: [emissive, 0, 0],
    opacity: 1,
    transparent: false,
    blending: undefined,
    version,
  }) as unknown as PageSurface

/** The writes of the proxy's buffer. */
const writes = (gpu: ReturnType<typeof mockGpu>) =>
  gpu.writes.filter(({ label }) => label === LABEL)
const words = (bytes: Uint8Array) =>
  new Uint32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
/** The word at `index` (counted from the header) of the last write that covers it. */
function wordAt(gpu: ReturnType<typeof mockGpu>, index: number) {
  const at = (RUNTIME_HEADER_WORDS + index) * 4
  for (const write of writes(gpu).reverse())
    if (write.offset <= at && at < write.offset + write.bytes.byteLength)
      return words(write.bytes)[(at - write.offset) / 4]
  throw new Error(`no write covers word ${index}`)
}

/** The header as the last write of it left it, and where a region of the buffer starts by it. */
function headerOf(gpu: ReturnType<typeof mockGpu>) {
  const last = writes(gpu)
    .filter(({ offset }) => offset === 0)
    .at(-1)!
  return words(last.bytes)
}
const region = (gpu: ReturnType<typeof mockGpu>, name: keyof typeof RUNTIME_HEADER) =>
  headerOf(gpu)[RUNTIME_HEADER[name]]

async function open(
  wear: (w: number) => { cut: RuntimeCutProxy; surface: PageSurface } | undefined,
) {
  installGpuGlobals()
  const roots = placementField(4, 3)
  roots.forEach((root, w) => (root.proxy = wear(w)))
  const packed = packDagSelection(roots)
  const gpu = mockGpu({ packed, limits: LIMITS })
  const selection = (await createGpuDagSelection(gpu.device, packed))!
  return { roots, packed, gpu, selection }
}

test('no placement wears a proxy: no buffer, nothing for the trace to read', async () => {
  const { gpu, selection } = await open(() => undefined)
  assert.equal(selection.proxyBuffers(), undefined)
  assert.equal(writes(gpu).length, 0)
  selection.dispose()
})

test('placements of one cut share its columns; each names its cut, its surface and its mark', async () => {
  const shared = cut(5, 3, 1),
    other = cut(2, 1, 2),
    glow = surface(9),
    plain = surface(0)
  const { gpu, selection } = await open((w) =>
    w < 12 ? { cut: shared, surface: glow } : w < 15 ? { cut: other, surface: plain } : undefined,
  )
  const buffers = selection.proxyBuffers()!
  assert.ok(buffers.proxy.size > 0)
  const instance = (w: number, k: number) =>
    wordAt(gpu, region(gpu, 'instancesWord') + w * INSTANCE_WORDS + k)
  // Twelve placements of the first cut: the same node and triangle, the first surface.
  for (let w = 0; w < 12; w++) {
    assert.equal(instance(w, INSTANCE.node), 0)
    assert.equal(instance(w, INSTANCE.triangle), 0)
    assert.equal(instance(w, INSTANCE.surface), 0)
  }
  // The second cut lies behind the first: five triangles, three nodes.
  assert.equal(instance(12, INSTANCE.node), 3)
  assert.equal(instance(12, INSTANCE.triangle), 5)
  assert.equal(instance(12, INSTANCE.surface), 1)
  // No proxy: none, whatever the others wear.
  assert.equal(instance(15, INSTANCE.node), RUNTIME_NONE)
  // The cut is written once.
  const triangleWrites = writes(gpu).filter(({ bytes }) => bytes.byteLength === 5 * 9 * 4)
  assert.equal(triangleWrites.length, 1, 'one upload of the shared cut')
  selection.dispose()
})

test('a surface goes up with the cut and again when its record moves on', async () => {
  const glow = surface(9)
  const { gpu, selection, packed, roots } = await open((w) =>
    w < 2 ? { cut: cut(2, 1, 1), surface: glow } : undefined,
  )
  /** The surface's seven floats as the last writes left them. */
  const floats = () =>
    Float32Array.from(
      Array.from({ length: 7 }, (_, k) => wordAt(gpu, region(gpu, 'surfacesWord') + k)),
      (word) => new Float32Array(new Uint32Array([word]).buffer)[0],
    )
  assert.equal(floats()[4], 9, 'its emission')
  assert.equal(floats()[0], 1, 'its tint, a lit surface with no metal')
  assert.equal(floats()[2], 0.25)
  // The host edits the material: its version moves, the next cut writes the slot again.
  glow.emissive = [3, 0, 0]
  glow.version = 2
  selection.dispatch(kernelUniforms(packed, roots, fieldCamera([0, 5, 20], [0, 0, 0]), 1))
  assert.equal(floats()[4], 3, 'the edited emission')
  selection.dispose()
})

test('a parked placement draws no proxy until it is taken back, and a mark follows its placement', async () => {
  const c = cut(2, 1, 1),
    s = surface(1)
  const { gpu, selection } = await open(() => ({ cut: c, surface: s }))
  const node = (w: number) =>
    wordAt(gpu, region(gpu, 'instancesWord') + w * INSTANCE_WORDS + INSTANCE.node)
  const mark = (w: number) =>
    wordAt(gpu, region(gpu, 'instancesWord') + w * INSTANCE_WORDS + INSTANCE.mark)
  selection.parkWorld(3, true)
  assert.equal(node(3), RUNTIME_NONE)
  selection.parkWorld(3, false)
  assert.equal(node(3), 0)
  selection.markWorld(4, 0x3c00_0001)
  assert.equal(mark(4), 0x3c00_0001)
  selection.dispose()
})

test('roots appended behind the others join with their instances', async () => {
  installGpuGlobals()
  const roots = placementField(4, 3),
    counts = dagRootCounts(roots)
  const c = cut(2, 1, 1),
    s = surface(1)
  roots.forEach((root) => (root.proxy = { cut: c, surface: s }))
  const packed = packDagSelection(roots.slice(0, 10), {
    pages: 2 * counts.pages,
    nodes: 2 * counts.nodes,
    worlds: 2 * roots.length,
  })
  const gpu = mockGpu({ packed, limits: LIMITS })
  const selection = (await createGpuDagSelection(gpu.device, packed))!
  assert.equal(selection.appendRoots(roots.slice(10)), true)
  const node = (w: number) =>
    wordAt(gpu, region(gpu, 'instancesWord') + w * INSTANCE_WORDS + INSTANCE.node)
  for (const w of [0, 9, 10, 15]) assert.equal(node(w), 0, `placement ${w}`)
  selection.dispose()
})

test('past its first tables the arena grows, the columns it held carried over by copies', async () => {
  // Cuts of a thousand triangles each, twice past the first layout's four thousand.
  const cuts = Array.from({ length: 6 }, (_, k) => cut(1000, 100, k + 1))
  const s = surface(1)
  const { gpu, selection } = await open((w) => (w < 6 ? { cut: cuts[w], surface: s } : undefined))
  assert.ok(selection.proxyBuffers()!.proxy.size > 0)
  // Every placement still names its own cut's first triangle.
  const triangles = Array.from({ length: 6 }, (_, w) =>
    wordAt(gpu, region(gpu, 'instancesWord') + w * INSTANCE_WORDS + INSTANCE.triangle),
  )
  assert.deepEqual(triangles, [0, 1000, 2000, 3000, 4000, 5000])
  selection.dispose()
})
