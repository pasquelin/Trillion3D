// What the reflection rig binds as the proxy (`runtime-proxy.gpu.ts` proves the engine's own): the scene's
// proxy of a few faces, each one placement of a two-triangle mesh at the identity, wearing a surface that
// emits the face's radiance, and the culling's tables it is read beside: the worlds the faces are placed by
// and the engine's stand-in tree (the header names no tree) — or, without faces, the engine's own stand-ins
// (`runtimeStandIns`): an empty header, no placement, no ray.
import { NO_INDEX } from '../../../packages/math/src/constants.ts'
import {
  proxyArena,
  proxyBuffer,
  proxyHeader,
} from '../../../packages/sdk-browser/src/lighting/bounce/proxyBuffer.fixture.ts'
import {
  PROXY_NODE_FLOATS,
  PROXY_TRIANGLE_FLOATS,
} from '../../../packages/sdk-core/src/contracts/writtenFormats.ts'
import { buildCutProxy } from '../../../packages/sdk-browser/src/geometry/runtime/runtimeProxy.ts'
import { sdkWasm } from '../../../packages/sdk-browser/src/wasm/sdkWasm.fixture.ts'
import { worldTableOn } from '../../../packages/sdk-browser/src/geometry/dag/worlds/worldTable.fixture.ts'
import { IDENTITY_MATRIX4 } from '../../../packages/math/src/matrix/matrix4.ts'
import { IDENTITY_WORLD } from '../../../packages/sdk-browser/src/session/host/matrixElements.ts'
import type { DeferredPlaceholders } from '../../../packages/sdk-browser/src/lighting/deferred/setup.ts'

/** A face of the rig's scene: the triangles it holds — two, nine floats each — and the radiance it gives. */
export type RigFace = { triangles: Float32Array; radiance: readonly [number, number, number] }

/** The two triangles of a face, as a mesh indexes them. */
const FACE_INDICES = Uint32Array.from([0, 1, 2, 3, 4, 5])

/** The words of the proxy's buffer for `faces`, header included: each face's cut by the engine's
 *  builder (`buildCutProxy`) over its two triangles, the cuts one after the other, and the instances,
 *  four words each — the node and triangle a face's cut starts at, the surface it wears, no mark. */
function proxyWords(faces: readonly RigFace[]) {
  const cuts = faces.map((face) => buildCutProxy(sdkWasm, FACE_INDICES, face.triangles))
  const instances: number[] = []
  let node = 0,
    triangle = 0
  cuts.forEach((cut, k) => {
    instances.push(node, triangle, k, 0)
    node += cut.nodeBounds.length / PROXY_NODE_FLOATS
    triangle += cut.triangles.length / PROXY_TRIANGLE_FLOATS
  })
  const columns = {
    triangles: Float32Array.from(cuts.flatMap((cut) => [...cut.triangles])),
    nodeBounds: Float32Array.from(cuts.flatMap((cut) => [...cut.nodeBounds])),
    nodeChildren: Uint32Array.from(cuts.flatMap((cut) => [...cut.nodeChildren])),
  }
  // Surface: no tint, opaque, the radiance the face gives.
  const surfaces = faces.map(({ radiance }) => [0, 0, 0, 1, ...radiance, 0])
  const arena = proxyArena(columns, surfaces)
  const header = proxyHeader(arena, {
    instances: faces.length,
    treeRoot: NO_INDEX,
    members: faces.length,
  })
  return { words: proxyBuffer(header, arena.words), instances: Uint32Array.from(instances) }
}

/** The proxy's buffer over `faces`, the records they stand in — the identity, its exact translation
 *  zeros, and their instances —, and the stand-in tree of `standIns`; without faces, the engine's
 *  stand-ins whole, as an image without a proxy binds them. */
export function rigProxy(
  device: GPUDevice,
  standIns: DeferredPlaceholders,
  faces: readonly RigFace[] = [],
) {
  const tree = standIns.runtimeTree
  if (!faces.length)
    return { proxy: standIns.runtime, proxyWorlds: standIns.runtimeWorlds, proxyTree: tree }
  const { words, instances } = proxyWords(faces)
  const proxy = device.createBuffer({
    size: words.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(proxy, 0, words)
  // Each placement at the identity, written as the host writes a worlds' table.
  const n = faces.length,
    identity = new Float32Array(n * 16)
  for (let k = 0; k < n; k++) identity.set(IDENTITY_MATRIX4, k * 16)
  const worlds = worldTableOn(
    device,
    identity,
    Array.from({ length: n }, () => ({ world: IDENTITY_WORLD })),
  )
  // The faces' instances in their records.
  worlds.write('Instance', 0, n, instances.buffer, 0)
  return { proxy, proxyWorlds: worlds.view, proxyTree: tree }
}
