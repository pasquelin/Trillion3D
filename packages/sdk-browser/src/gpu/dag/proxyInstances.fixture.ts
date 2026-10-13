// What the proofs of the run-time proxy's instances share: a device double, a packing whose placements wear
// cuts and surfaces, and the words the proxy's buffer holds as the last writes left them.
import { placementField } from './placementTree.fixture.ts'
import { createGpuDagSelection, packDagSelection } from './selection.ts'
import { BACKEND, fakeDevice, writtenBytes } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'
import type { RuntimeCutProxy } from '../../../../sdk-core/src/contracts/proxy.ts'
import type { PageSurface } from '../../page/surface.ts'
import type { RootProxy } from '../../page/selection/types.ts'
import { RUNTIME_HEADER, RUNTIME_HEADER_WORDS } from '../../bounce/runtimeLayout.ts'

export const LIMITS = {
  maxBufferSize: 1 << 28,
  maxStorageBufferBindingSize: 1 << 28,
  maxStorageBuffersPerShaderStage: 16,
}
const LABEL = 'Trillion3D run-time proxy'

/** A cut of `triangles` triangles over `nodes` nodes, columns of a known value. */
export const cut = (triangles: number, nodes: number, value: number): RuntimeCutProxy => ({
  triangles: new Float32Array(triangles * 9).fill(value),
  albedo: new Uint32Array(triangles).fill(0xffffffff),
  nodeBounds: new Float32Array(nodes * 6).fill(value),
  nodeChildren: new Uint32Array(nodes * 12).fill(7),
  cellMetres: 0.1,
})
export const surface = (emissive: number, version = 1): PageSurface =>
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
export const writes = (gpu: ReturnType<typeof fakeDevice>) =>
  gpu.writes.filter(({ buffer }) => buffer.label === LABEL)
const words = (bytes: Uint8Array) =>
  new Uint32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
/** The word at `index` (counted from the header) of the last write that covers it. */
export function wordAt(gpu: ReturnType<typeof fakeDevice>, index: number) {
  const at = (RUNTIME_HEADER_WORDS + index) * 4
  for (const write of writes(gpu).reverse())
    if (write.offset <= at && at < write.offset + write.data.byteLength)
      return words(writtenBytes(write))[(at - write.offset) / 4]
  throw new Error(`no write covers word ${index}`)
}

/** The header as the last write of it left it, and where a region of the buffer starts by it. */
function headerOf(gpu: ReturnType<typeof fakeDevice>) {
  const last = writes(gpu)
    .filter(({ offset }) => offset === 0)
    .at(-1)!
  return words(writtenBytes(last))
}
export const region = (gpu: ReturnType<typeof fakeDevice>, name: keyof typeof RUNTIME_HEADER) =>
  headerOf(gpu)[RUNTIME_HEADER[name]]

export async function open(wear: (w: number) => RootProxy | undefined) {
  installGpuGlobals()
  const roots = placementField(4, 3)
  roots.forEach((root, w) => (root.proxy = wear(w)))
  const packed = packDagSelection(roots)
  const gpu = fakeDevice({ ...BACKEND, packed, limits: LIMITS })
  const selection = (await createGpuDagSelection(gpu.device, packed))!
  return { roots, packed, gpu, selection }
}
