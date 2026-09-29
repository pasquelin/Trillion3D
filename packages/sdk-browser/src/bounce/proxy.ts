import { createSceneProxyMotion } from '../../../sdk-core/src/scene/core/proxyMotion.ts';
import { ensureProxyFits } from './limits.ts';
import {
  BOUNCE_SETTINGS,
  PROXY_NODE_FLOATS,
  type SceneProxy,
} from '../../../sdk-core/src/index.ts';
import { PROXY_HEADER_WORDS, PROXY_LAYOUT_WORD } from './nodeWgsl.ts';

/** Words of an array, whatever its type: a column is a sequence of words, nothing more. */
const words = (data: Float32Array | Uint32Array) =>
  new Uint32Array(data.buffer as ArrayBuffer, data.byteOffset, data.length);

/** Resident albedo buffer: written once, at prepare, never touched by a frame. */
function albedoBuffer(device: GPUDevice, data: Uint32Array) {
  // A storage binding cannot be empty: an absent proxy keeps four bytes of zero, and the shader
  // sees it as a tree with no node, hence a ray that hits nothing.
  const buffer = device.createBuffer({
    label: 'Trillion3D bounce proxy albedo v2',
    size: Math.max(4, data.byteLength),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  });
  new Uint32Array(buffer.getMappedRange()).set(data);
  buffer.unmap();
  return buffer;
}

/**
 * Visited nodes per ray once an owner has moved. Refit keeps the topology and rewrites only the
 * bounds of the moved triangles' ancestors; a node whose bounds were never rewritten keeps a box
 * inside its original parent's, so only a widened node can be visited beyond what the still tree
 * visits, and each at most once. The still bound plus the widened nodes, capped by the node count
 * (a complete walk), is therefore enough: a ray never runs out before it would have on a still
 * tree, and a door costs its ancestors, not a doubled bound.
 */
export function proxyMotionSteps(nodes: number, widenedNodes: number) {
  return Math.min(nodes, BOUNCE_SETTINGS.traversalSteps + widenedNodes);
}

export type GpuBounceProxy = ReturnType<typeof createGpuBounceProxy>;

/** Canonical triangles and owner poses in one binding. Motion refits the existing BVH in place;
 *  immutable triangles and albedo never expand with the number of owners. */
export function createGpuBounceProxy(device: GPUDevice, proxy: SceneProxy) {
  ensureProxyFits(device, proxy);
  const motion = createSceneProxyMotion(proxy);
  const data = motion.data;
  const columns = [
    words(data?.triangles ?? new Float32Array(0)),
    words(data?.nodeBounds ?? new Float32Array(0)),
    words(data?.nodeChildren ?? new Uint32Array(0)),
    words(data?.triangleGroups ?? new Uint32Array(0)),
    words(data?.groupOffsets ?? new Uint32Array(0)),
    words(data?.owners ?? new Uint32Array(0)),
    words(motion.transforms),
  ];
  // Start rank of each column, counted from the first word after the header: that is what the
  // shader adds to a triangle or node index.
  const starts: number[] = [];
  let total = 0;
  for (const column of columns) {
    starts.push(total);
    total += column.length;
  }
  const buffer = device.createBuffer({
    label: 'Trillion3D resident proxy v2',
    size: (PROXY_HEADER_WORDS + Math.max(4, total)) * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    mappedAtCreation: true,
  });
  const mapped = new Uint32Array(buffer.getMappedRange());
  // Node count is read from the bounds column, as `arrayLength` did before the three columns
  // fit in one buffer: the same value, from the same source.
  mapped[PROXY_LAYOUT_WORD] = columns[1].length / PROXY_NODE_FLOATS;
  for (let index = 0; index < columns.length; index++) {
    mapped[index < 3 ? PROXY_LAYOUT_WORD + 1 + index : 9 + index] = starts[index];
    mapped.set(columns[index], PROXY_HEADER_WORDS + starts[index]);
  }
  buffer.unmap();
  const albedo = albedoBuffer(device, data?.albedo ?? new Uint32Array(0));
  const motionFlag = new Uint32Array([1]);
  /** Revision, then the motion step bound (`proxyMotionSteps`), at header words 16 and 17. */
  const revisionWords = new Uint32Array(2);
  const mutableColumns = [1, 2, 6];
  return {
    buffer,
    albedo,
    /** What the proxy actually occupies in GPU memory, published in the diagnostic. */
    bytes: (PROXY_HEADER_WORDS + Math.max(4, total)) * 4 + (data?.albedo.byteLength ?? 0),
    get hostBytes() {
      return motion.hostBytes;
    },
    triangleCount: proxy.triangles,
    nodeCount: proxy.nodes,
    bounds: motion.bounds,
    triangleBoxes: motion.triangleBoxes,
    changedTriangles: motion.changedTriangles,
    get dynamic() {
      return motion.dynamic;
    },
    get revision() {
      return motion.revision;
    },
    sync(worldOf: (source: number) => ArrayLike<number> | undefined) {
      if (!motion.sync(worldOf)) return false;
      for (const index of mutableColumns)
        device.queue.writeBuffer(buffer, (PROXY_HEADER_WORDS + starts[index]) * 4, columns[index]);
      device.queue.writeBuffer(buffer, 11 * 4, motionFlag);
      revisionWords[0] = motion.revision;
      revisionWords[1] = proxyMotionSteps(proxy.nodes, motion.widenedNodes);
      device.queue.writeBuffer(buffer, 16 * 4, revisionWords);
      return true;
    },
    get errorMetres() {
      return motion.errorMetres;
    },
    cellMetres: proxy.cellMetres,
    dispose() {
      buffer.destroy();
      albedo.destroy();
    },
  };
}
