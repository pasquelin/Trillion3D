// What the reflection rig binds as the proxy (`runtime-proxy.gpu.ts` proves the engine's own): the scene's
// proxy of a few faces, each one placement of a two-triangle mesh at the identity, wearing a surface that
// emits the face's radiance, and the culling's tables it is read beside: the worlds the faces are placed by
// and a placement tree of none (the header names no tree) — or an empty header, no placement, no ray.
import { NO_INDEX } from '../../../packages/math/src/constants.ts'
import { RUNTIME_HEADER_WORDS } from '../../../packages/sdk-browser/src/bounce/runtimeLayout.ts'
import {
  proxyArena,
  proxyBuffer,
} from '../../../packages/sdk-browser/src/bounce/proxyBuffer.fixture.ts'
import {
  PROXY_NODE_FLOATS,
  PROXY_NODE_WORDS,
  PROXY_TRIANGLE_FLOATS,
} from '../../../packages/sdk-core/src/contracts/writtenFormats.ts'
import { worldTableOn } from '../../../packages/sdk-browser/src/gpu/dag/worldTable.fixture.ts'
import { IDENTITY_MATRIX4 } from '../../../packages/math/src/matrix/matrix4.ts'
import { IDENTITY_WORLD } from '../../../packages/sdk-browser/src/host/matrixElements.ts'
import { createTreeTable } from '../../../packages/sdk-browser/src/gpu/dag/treeTable.ts'

/** A face of the rig's scene: the triangles it holds — two, nine floats each — and the radiance it gives. */
export type RigFace = { triangles: Float32Array; radiance: readonly [number, number, number] }

/** The instances of `faces`, four words each: the node and triangle a face starts at, the surface it
 *  wears, no mark. */
const instanceWords = (faces: readonly RigFace[]) =>
  Uint32Array.from(faces.flatMap((_, k) => [k, 2 * k, k, 0]))

/** The words of the proxy's buffer for `faces`, header included: each face its node over its two
 *  triangles, the node's bounds theirs, its first child holding both, its box the whole of the node's. */
function proxyWords(faces: readonly RigFace[]) {
  const n = faces.length
  const triangles = new Float32Array(2 * n * PROXY_TRIANGLE_FLOATS),
    nodeBounds = new Float32Array(n * PROXY_NODE_FLOATS),
    nodeChildren = new Uint32Array(n * PROXY_NODE_WORDS)
  faces.forEach((face, k) => {
    triangles.set(face.triangles, 2 * k * PROXY_TRIANGLE_FLOATS)
    const low = [Infinity, Infinity, Infinity],
      high = [-Infinity, -Infinity, -Infinity]
    for (let v = 0; v < 6; v++)
      for (let axis = 0; axis < 3; axis++) {
        low[axis] = Math.min(low[axis], face.triangles[v * 3 + axis])
        high[axis] = Math.max(high[axis], face.triangles[v * 3 + axis])
      }
    nodeBounds.set([...low, ...high], k * PROXY_NODE_FLOATS)
    // The first child: its box bytes the node's whole (lows 0, highs 255), two triangles, present; the
    // others are absent.
    nodeChildren.set([0xff000000, (1 << 24) | (2 << 16) | (255 << 8) | 255], k * PROXY_NODE_WORDS)
  })
  // Surface: no tint, opaque, the radiance the face gives.
  const surfaces = faces.map(({ radiance }) => [0, 0, 0, 1, ...radiance, 0])
  const arena = proxyArena({ triangles, nodeBounds, nodeChildren }, surfaces)
  const header = {
    instances: n,
    ...arena.regions,
    treeRoot: NO_INDEX,
    members: n,
    error: 0,
    copies: 0,
  }
  return proxyBuffer(header, arena.words)
}

/** The proxy's buffer over `faces`, the records they stand in — the identity, its exact translation
 *  zeros, and their instances —, and the table of no placement tree. */
export function rigProxy(device: GPUDevice, faces: readonly RigFace[] = []) {
  const words = faces.length ? proxyWords(faces) : new Uint32Array(RUNTIME_HEADER_WORDS + 1)
  const proxy = device.createBuffer({
    size: words.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(proxy, 0, words)
  // Each placement at the identity, written as the host writes a worlds' table.
  const n = Math.max(1, faces.length),
    identity = new Float32Array(n * 16)
  for (let k = 0; k < n; k++) identity.set(IDENTITY_MATRIX4, k * 16)
  const worlds = worldTableOn(
    device,
    identity,
    Array.from({ length: n }, () => ({ world: IDENTITY_WORLD })),
  )
  // The faces' instances in their records.
  const held = instanceWords(faces)
  if (held.length) worlds.write('Instance', 0, faces.length, held.buffer, 0)
  return {
    proxy,
    proxyWorlds: worlds.view,
    proxyTree: createTreeTable(device, undefined).view,
  }
}
