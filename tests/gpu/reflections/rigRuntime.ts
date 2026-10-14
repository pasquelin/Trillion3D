// What the reflection rig binds as the proxy (`runtime-proxy.gpu.ts` proves the engine's own): the scene's
// proxy of a few faces, each one placement of a two-triangle mesh at the identity, wearing a surface that
// emits the face's radiance, and the culling's tables it is read beside: the worlds the faces are placed by
// and a placement tree of none (the header names no tree) — or an empty header, no placement, no ray —, and
// the store of the answers when the view holds one, else a texel.
import { NO_INDEX } from '../../../packages/math/src/constants.ts'
import {
  RUNTIME_HEADER,
  RUNTIME_HEADER_WORDS,
  STORE_LAYERS,
  SURFACE_WORDS,
} from '../../../packages/sdk-browser/src/bounce/runtimeLayout.ts'
import { worldTableOn } from '../../../packages/sdk-browser/src/gpu/dag/worldTable.fixture.ts'
import { IDENTITY_MATRIX4 } from '../../../packages/math/src/matrix/matrix4.ts'
import { IDENTITY_WORLD } from '../../../packages/sdk-browser/src/host/matrixElements.ts'
import { createTreeTable } from '../../../packages/sdk-browser/src/gpu/dag/treeTable.ts'
import type { ScreenReflection } from '../../../packages/sdk-browser/src/reflections/gpu.ts'

/** A face of the rig's scene: the triangles it holds — two, nine floats each — and the radiance it gives. */
export type RigFace = { triangles: Float32Array; radiance: readonly [number, number, number] }

/** Floats of a node's exact bounds, words of its four children, and a triangle's floats. */
const NODE_FLOATS = 6,
  NODE_WORDS = 12,
  TRIANGLE_FLOATS = 9

/** The instances of `faces`, four words each: the node and triangle a face starts at, the surface it
 *  wears, no mark. */
const instanceWords = (faces: readonly RigFace[]) =>
  Uint32Array.from(faces.flatMap((_, k) => [k, 2 * k, k, 0]))

/** The words of the proxy's buffer for `faces`, header included. */
function proxyWords(faces: readonly RigFace[]) {
  const n = faces.length
  const surfacesAt = 0,
    trianglesAt = surfacesAt + n * SURFACE_WORDS,
    boundsAt = trianglesAt + 2 * n * TRIANGLE_FLOATS,
    childrenAt = boundsAt + n * NODE_FLOATS,
    total = childrenAt + n * NODE_WORDS
  const words = new Uint32Array(RUNTIME_HEADER_WORDS + total + 1)
  const floats = new Float32Array(words.buffer)
  const at = RUNTIME_HEADER
  words[at.instances] = n
  words[at.surfacesWord] = surfacesAt
  words[at.trianglesWord] = trianglesAt
  words[at.copyWorldsWord] = surfacesAt
  words[at.boundsWord] = boundsAt
  words[at.childrenWord] = childrenAt
  words[at.treeRoot] = NO_INDEX
  words[at.members] = n
  const base = RUNTIME_HEADER_WORDS
  faces.forEach(({ triangles, radiance }, k) => {
    // Surface: no tint, opaque, the radiance it gives.
    floats.set([0, 0, 0, 1, ...radiance], base + surfacesAt + k * SURFACE_WORDS)
    floats.set(triangles, base + trianglesAt + 2 * k * TRIANGLE_FLOATS)
    const low = [Infinity, Infinity, Infinity],
      high = [-Infinity, -Infinity, -Infinity]
    for (let v = 0; v < 6; v++)
      for (let axis = 0; axis < 3; axis++) {
        low[axis] = Math.min(low[axis], triangles[v * 3 + axis])
        high[axis] = Math.max(high[axis], triangles[v * 3 + axis])
      }
    floats.set([...low, ...high], base + boundsAt + k * NODE_FLOATS)
    // The first child holds both triangles, its box the whole of the node's; the others are absent.
    const child = base + childrenAt + k * NODE_WORDS
    words[child] = 0xff000000
    words[child + 1] = (1 << 24) | (2 << 16) | (255 << 8) | 255
    words[child + 2] = 0
  })
  return words
}

/** The proxy's buffer over `faces`, the records they stand in — the identity, its exact translation
 *  zeros, and their instances —, the table of no placement tree, and the store of the answers. */
export function rigProxy(
  device: GPUDevice,
  reflection: ScreenReflection,
  faces: readonly RigFace[] = [],
) {
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
    store:
      reflection.store.view ??
      device
        .createTexture({
          size: [1, 1, STORE_LAYERS],
          format: 'r32uint',
          usage: GPUTextureUsage.STORAGE_BINDING,
        })
        .createView({ dimension: '2d-array' }),
  }
}
