import {
  createSceneProxyMotion,
  type ProxySync,
} from '../../../sdk-core/src/scene/core/proxyMotion.ts';
import { ensureProxyFits } from './limits.ts';
import {
  BOUNCE_SETTINGS,
  PROXY_NODE_FLOATS,
  type SceneProxy,
} from '../../../sdk-core/src/index.ts';
import {
  PROXY_CASTLESS_WORD,
  PROXY_LAYOUT_WORD,
  PROXY_REVISION_WORD,
  PROXY_STEPS_WORD,
} from './nodeWgsl.ts';
import { PROXY_HEADER_WORDS } from './sizes.ts';

/** Ranks of the columns a sync rewrites. */
const TRIANGLES = 0,
  BOUNDS = 1,
  CHILDREN = 2,
  GROUPS = 3,
  TRANSFORMS = 6,
  CASTLESS = 7;
/** Columns motion rewrites whole: node bounds, node children and owner transforms. */
const MOVING_COLUMNS = [BOUNDS, CHILDREN, TRANSFORMS];

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
    // One bit per group, set when every owner of the group casts no shadow (`castless`).
    new Uint32Array(Math.ceil(proxy.groups / 32)),
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
  mapped[PROXY_LAYOUT_WORD] = columns[BOUNDS].length / PROXY_NODE_FLOATS;
  for (let index = 0; index < columns.length; index++) {
    const word = index < 3 ? PROXY_LAYOUT_WORD + 1 + index : 9 + index;
    mapped[index === CASTLESS ? PROXY_CASTLESS_WORD : word] = starts[index];
    mapped.set(columns[index], PROXY_HEADER_WORDS + starts[index]);
  }
  /** Visited nodes per ray: the built tree's bound, plus each node motion let into a ray. */
  const steps = () => BOUNCE_SETTINGS.traversalSteps + motion.grownNodes;
  mapped[PROXY_STEPS_WORD] = steps();
  buffer.unmap();
  const albedo = albedoBuffer(device, data?.albedo ?? new Uint32Array(0));
  // Revision and steps, written after each change.
  const tail = new Uint32Array(2);
  /** A column, or the word range `[from, to)` of it. */
  const write = (index: number, from = 0, to = columns[index].length) =>
    device.queue.writeBuffer(
      buffer,
      (PROXY_HEADER_WORDS + starts[index] + from) * 4,
      columns[index],
      from,
      to - from,
    );
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
    /** Some leaf is traced under its owners' poses. */
    get dynamic() {
      return motion.dynamic;
    },
    /** Owned leaves wait for their still streak: the host keeps syncing each frame. */
    get settling() {
      return motion.settling;
    },
    get revision() {
      return motion.revision;
    },
    /** Visited nodes a ray may take, as the shader reads it. */
    get steps() {
      return steps();
    },
    /** Uploads only what changed: the triangles and leaf flags a settle or a resume rewrote, and on
     *  motion the tree and the poses. A leaf never posed away from bind uploads no triangle. */
    sync(worldOf: (source: number) => ArrayLike<number> | undefined): ProxySync {
      const change = motion.sync(worldOf);
      if (!change) return null;
      const spans = motion.take();
      if (spans.triangles) write(TRIANGLES, spans.triangles[0] * 9, spans.triangles[1] * 9);
      if (spans.groups) write(GROUPS, ...spans.groups);
      if (change === 'moved') for (const index of MOVING_COLUMNS) write(index);
      else if (spans.childWords) write(CHILDREN, ...spans.childWords);
      tail[0] = motion.revision;
      tail[1] = steps();
      device.queue.writeBuffer(buffer, PROXY_REVISION_WORD * 4, tail);
      return change;
    },
    /**
     * Marks the groups whose every owner casts no shadow (`castsNone` of each owner's source node
     * and of the mesh it places, `-1` for none, #966), which the far sun's shadow ray passes; true
     * when a mark changed, then uploaded.
     */
    castless(castsNone: (source: number, mesh: number) => boolean) {
      const { groupOffsets, owners, sourceMeshes } = data,
        marks = new Uint32Array(columns[CASTLESS].length);
      for (let group = 0; group < proxy.groups; group++) {
        let none = true;
        for (let owner = groupOffsets[group]; none && owner < groupOffsets[group + 1]; owner++) {
          const source = owners[owner * 2];
          none = castsNone(source, sourceMeshes[source] ?? -1);
        }
        if (none) marks[group >> 5] |= 1 << (group & 31);
      }
      if (marks.every((word, at) => word === columns[CASTLESS][at])) return false;
      columns[CASTLESS].set(marks);
      write(CASTLESS);
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
