import { PROXY_NODE_FLOATS, type SceneProxy } from '../sdk-core/src/index.ts';
import { PROXY_HEADER_WORDS, PROXY_LAYOUT_WORD } from './bounceNodeWgsl.ts';

/** Words of an array, whatever its type: a column is a sequence of words, nothing more. */
const words = (data: Float32Array | Uint32Array) =>
  new Uint32Array(data.buffer, data.byteOffset, data.length);

/** Resident albedo buffer: written once, at prepare, never touched by a frame. */
function albedoBuffer(device: GPUDevice, data: Uint32Array) {
  // A storage binding cannot be empty: an absent proxy keeps four bytes of zero, and the shader
  // sees it as a tree with no node, hence a ray that hits nothing.
  const buffer = device.createBuffer({
    label: 'WG bounce proxy albedo v2',
    size: Math.max(4, data.byteLength),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  });
  new Uint32Array(buffer.getMappedRange()).set(data);
  buffer.unmap();
  return buffer;
}

export type GpuBounceProxy = ReturnType<typeof createGpuBounceProxy>;

/**
 * Resident GPU-memory proxy: world triangles, the two columns of its BVH and the header that
 * says where each starts, in **one buffer**; albedo in a second. Written once for all, never
 * reloaded, never camera-dependent (LC1) — that is what probe rays hit, and it changes only if
 * the cache changes.
 *
 * One binding for the traversal is what lets **both** lighting passes fire the far-shadow ray:
 * the blend pass's fragment stage had only one free storage buffer of the eight the spec
 * guarantees.
 *
 * No light is written there: geometry and an albedo, nothing else. The four shadow-ray settings
 * and its two counters live in the header, written by `gpuSunFarShadow`.
 */
export function createGpuBounceProxy(device: GPUDevice, proxy: SceneProxy) {
  const data = proxy.data;
  const columns = [
    words(data?.triangles ?? new Float32Array(0)),
    words(data?.nodeBounds ?? new Float32Array(0)),
    words(data?.nodeChildren ?? new Uint32Array(0)),
  ];
  // Start rank of each column, counted from the first word after the header: that is what the
  // shader adds to a triangle or node index.
  const starts = [0, columns[0].length, columns[0].length + columns[1].length];
  const total = starts[2] + columns[2].length;
  const buffer = device.createBuffer({
    label: 'WG resident proxy v2',
    size: (PROXY_HEADER_WORDS + Math.max(4, total)) * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    mappedAtCreation: true,
  });
  const mapped = new Uint32Array(buffer.getMappedRange());
  // Node count is read from the bounds column, as `arrayLength` did before the three columns
  // fit in one buffer: the same value, from the same source.
  mapped[PROXY_LAYOUT_WORD] = columns[1].length / PROXY_NODE_FLOATS;
  for (let index = 0; index < 3; index++) {
    mapped[PROXY_LAYOUT_WORD + 1 + index] = starts[index];
    mapped.set(columns[index], PROXY_HEADER_WORDS + starts[index]);
  }
  buffer.unmap();
  const albedo = albedoBuffer(device, data?.albedo ?? new Uint32Array(0));
  return {
    buffer,
    albedo,
    /** What the proxy actually occupies in GPU memory, published in the diagnostic. */
    bytes: total * 4 + (data?.albedo.byteLength ?? 0),
    triangleCount: proxy.triangles,
    nodeCount: proxy.nodes,
    bounds: proxy.bounds,
    errorMetres: proxy.errorMetres,
    cellMetres: proxy.cellMetres,
    dispose() {
      buffer.destroy();
      albedo.destroy();
    },
  };
}
