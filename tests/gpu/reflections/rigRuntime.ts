// What the reflection rig binds as the proxy (`runtime-proxy.gpu.ts` proves the engine's own): the scene's
// proxy of a few faces, each one placement of a two-triangle mesh at the identity, wearing a surface that
// emits the face's radiance — or an empty header in each of its two places, no placement, no ray —, and the
// store of the answers when the view holds one, else a texel.
import {
  INSTANCE_WORDS,
  RUNTIME_HEADER,
  RUNTIME_HEADER_WORDS,
  RUNTIME_NONE,
  STORE_LAYERS,
  SURFACE_WORDS,
} from '../../../packages/sdk-browser/src/bounce/runtimeLayout.ts'
import type { ScreenReflection } from '../../../packages/sdk-browser/src/reflections/gpu.ts'

/** A face of the rig's scene: the triangles it holds — two, nine floats each — and the radiance it gives. */
export type RigFace = { triangles: Float32Array; radiance: readonly [number, number, number] }

/** Floats of a node's exact bounds, words of its four children, and a triangle's floats. */
const NODE_FLOATS = 6,
  NODE_WORDS = 12,
  TRIANGLE_FLOATS = 9

/** The words of the proxy's buffer for `faces`, header included. */
function proxyWords(faces: readonly RigFace[]) {
  const n = faces.length
  const surfacesAt = n * INSTANCE_WORDS,
    trianglesAt = surfacesAt + n * SURFACE_WORDS,
    boundsAt = trianglesAt + 2 * n * TRIANGLE_FLOATS,
    childrenAt = boundsAt + n * NODE_FLOATS,
    total = childrenAt + n * NODE_WORDS
  const words = new Uint32Array(RUNTIME_HEADER_WORDS + total + 1)
  const floats = new Float32Array(words.buffer)
  const at = RUNTIME_HEADER
  words[at.instances] = n
  words[at.instancesWord] = 0
  words[at.surfacesWord] = surfacesAt
  words[at.trianglesWord] = trianglesAt
  words[at.copyWorldsWord] = surfacesAt
  words[at.boundsWord] = boundsAt
  words[at.childrenWord] = childrenAt
  words[at.treeRoot] = RUNTIME_NONE
  words[at.members] = n
  words[at.worldStride] = 16
  words[at.worldRows] = n
  const base = RUNTIME_HEADER_WORDS
  faces.forEach(({ triangles, radiance }, k) => {
    // Instance: the node and triangle it starts at, the surface it wears, no mark.
    words.set([k, 2 * k, k, 0], base + k * INSTANCE_WORDS)
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
  // The faces stand at the identity.
  const identity = new Float32Array(Math.max(1, faces.length) * 16)
  for (let k = 0; k < Math.max(1, faces.length); k++)
    for (const diagonal of [0, 5, 10, 15]) identity[k * 16 + diagonal] = 1
  const worlds = device.createBuffer({
    size: identity.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(worlds, 0, identity)
  return {
    runtime: { proxy, worlds },
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
