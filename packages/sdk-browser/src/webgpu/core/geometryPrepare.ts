import type { HostAttributes } from '../../host/resources.ts';
import type { PageRec } from '../../page/selection/selection.ts';
import type { GeometryBlock } from '../row/pageRowMaterial.ts';
import { COLOR_FLOATS, UV_FLOATS, colorFloatAt, uvBufferFloats } from './vertexColors.ts';
type GeometryBlocks = Map<HostAttributes, GeometryBlock>;
type List = HostAttributes[string];

/** How each list a pool block carries is laid out: its buffer, its floats per vertex, and the
 *  host lists it is written from, each with its width and the value of a missing component — a
 *  normal and a tangent share seven floats a vertex, a colour rides at the tail of the UVs. */
// prettier-ignore
const LAYOUT = {
  position: { buffer: 'concatPos', stride: 3, parts: [['position', 3, 0]] },
  uv: { buffer: 'concatUv', stride: UV_FLOATS, parts: [['uv', UV_FLOATS, 0]] },
  color: { buffer: 'concatUv', stride: COLOR_FLOATS, parts: [['color', COLOR_FLOATS, 1]] },
  normal: { buffer: 'concatNrm', stride: 7, parts: [['normal', 3, 0], ['tangent', 4, 0]] },
} as const;
export type PoolList = keyof typeof LAYOUT;
const LISTS = Object.keys(LAYOUT) as PoolList[],
  BUFFERS = ['concatPos', 'concatUv', 'concatNrm'] as const;
type Buffers<T> = Record<(typeof BUFFERS)[number], T>;
/** Floats, grown to the largest write and kept: a steady frame allocates nothing. */
let scratch = new Float32Array(0);

/**
 * THE FLOAT VERTEX POOL of the WebGPU passes: the geometry they read as floats — the clusters no
 * quantized page covers, a cache that carries none, a world's dynamic geometry (#573). Its buffers
 * are sized once, at open, with room for as many vertices again as its dynamic geometry holds —
 * none when it holds none —: a block a record takes later is placed there (`place`), a dynamic
 * geometry's rewritten ranges are written in place (`write`), nothing is reallocated. Colours ride
 * at the tail of the UV buffer (`vertexColors.ts`), which carries none when no geometry has any.
 */
export function createVertexPool(
  device: GPUDevice,
  capacity: number,
  coloured: boolean,
  blocks: GeometryBlocks,
) {
  let used = 0;
  const floats: Buffers<number> = {
    ...{ concatPos: capacity * 3, concatNrm: capacity * 7 },
    concatUv: uvBufferFloats(capacity, coloured),
  };
  const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
  const buffers = Object.fromEntries(
    BUFFERS.map((key) => {
      const label = `Trillion3D transparent geometry ${key}`;
      return [key, device.createBuffer({ label, size: Math.max(4, floats[key] * 4), usage })];
    }),
  ) as Buffers<GPUBuffer>;
  /** The float of `name`'s buffer vertex `vertex` starts at: in the UVs' tail for a colour. */
  const offsetOf = (name: PoolList, vertex: number) =>
    name === 'color' ? colorFloatAt(capacity, vertex) : vertex * LAYOUT[name].stride;
  /** Fills the scratch with vertices `from` to `from + n - 1` of list `name` of `a`: its floats. */
  const fill = (a: HostAttributes, name: PoolList, from: number, n: number) => {
    const { stride, parts } = LAYOUT[name];
    if (scratch.length < n * stride) scratch = new Float32Array(n * stride);
    let part = 0;
    for (const [source, width, missing] of parts) {
      const list: List | undefined = a[source];
      for (let i = 0; i < n; i++)
        for (let c = 0; c < width; c++)
          scratch[part + i * stride + c] =
            list && c < list.itemSize ? list.getComponent(from + i, c) : missing;
      part += width;
    }
    return n * stride;
  };
  /** Whether `attributes` carry list `name`: a missing one reads zero, as a new buffer holds. */
  const holds = (attributes: HostAttributes, name: PoolList) =>
    (name !== 'color' || coloured) && LAYOUT[name].parts.some(([source]) => attributes[source]);
  /** The bytes `count` vertices of list `name` of `attributes` weigh in the pool, if it holds it. */
  const weigh = (attributes: HostAttributes, name: PoolList, count: number) =>
    holds(attributes, name) ? count * LAYOUT[name].stride * 4 : 0;
  /** A block for `attributes` in the room left; undefined when the room is spent. */
  const claim = (attributes: HostAttributes, dynamic: boolean) => {
    const count = attributes.position?.count ?? 0;
    if (used + count > capacity || (attributes.color && !coloured)) return undefined;
    const block: GeometryBlock = {
      ...{ vertexBase: used, count, hasUv: !!attributes.uv, hasNormal: !!attributes.normal },
      ...{ hasTangent: !!attributes.tangent, hasColor: !!attributes.color, dynamic },
    };
    blocks.set(attributes, block);
    used += count;
    return block;
  };
  return {
    ...buffers,
    /** Places each geometry of `sourced`, dynamic or not, and uploads the buffers whole: the
     *  open's one packing. */
    pack(sourced: ReadonlyMap<HostAttributes, boolean>) {
      const arrays = Object.fromEntries(
        BUFFERS.map((key) => [key, new Float32Array(floats[key])]),
      ) as Buffers<Float32Array>;
      for (const [attributes, dynamic] of sourced) {
        const block = claim(attributes, dynamic);
        for (const name of LISTS) {
          if (!block || !holds(attributes, name)) continue;
          const floats = scratch.subarray(0, fill(attributes, name, 0, block.count));
          arrays[LAYOUT[name].buffer].set(floats, offsetOf(name, block.vertexBase));
        }
      }
      for (const key of BUFFERS) device.queue.writeBuffer(buffers[key], 0, arrays[key]);
      scratch = new Float32Array(0); // the open's largest list is not kept
    },
    /** The block of `attributes`, placed in the room the open left when it has none — a record
     *  mounted since —; undefined when that room is spent. `dynamic` marks its rows. */
    place(attributes: HostAttributes, dynamic = false) {
      const known = blocks.get(attributes);
      if (known) return known;
      const block = claim(attributes, dynamic);
      if (block) for (const name of LISTS) this.write(attributes, name, 0, block.count);
      return block;
    },
    /** The bytes `place` then `write` send for `ranges` of `attributes`: each list whole first
     *  when its block is still to place. */
    bytesOf(attributes: HostAttributes, ranges: readonly { name: PoolList; count: number }[]) {
      let bytes = 0;
      if (!blocks.has(attributes))
        for (const name of LISTS) bytes += weigh(attributes, name, attributes.position?.count ?? 0);
      for (const { name, count } of ranges) bytes += weigh(attributes, name, count);
      return bytes;
    },
    /** Writes vertices `from` to `from + count - 1` of list `name` of placed `attributes` — a
     *  normal with its tangent — in place, no buffer allocated; returns the bytes written. */
    write(attributes: HostAttributes, name: PoolList, from: number, count: number) {
      const block = blocks.get(attributes);
      if (!block || !holds(attributes, name)) return 0;
      const size = fill(attributes, name, from, Math.min(count, block.count - from));
      const at = offsetOf(name, block.vertexBase + from) * 4;
      device.queue.writeBuffer(buffers[LAYOUT[name].buffer], at, scratch, 0, size);
      return size * 4;
    },
  };
}

export type VertexPool = ReturnType<typeof createVertexPool>;

/**
 * Packs, once, the source geometry the passes still read as floats: that of the clusters no
 * quantized page covers, from a cache that carries no geometry page. A cluster drawn from its
 * page contributes no vertex here, and its primitive contributes none unless another of its
 * clusters needs one: that is the whole point of reading a page in place.
 */
export function prepareWebgpuGeometry(
  device: GPUDevice,
  allPages: PageRec[],
  geometryBlocks: GeometryBlocks,
) {
  const sourced = new Map<HostAttributes, boolean>();
  for (const rec of allPages)
    if (!rec.geometryPage)
      sourced.set(rec.attributes, rec.sourceMesh?.geometry.usage === 'dynamic');
  let vertices = 0,
    room = 0,
    coloured = false;
  for (const [attributes, dynamic] of sourced) {
    const n = attributes.position?.count ?? 0;
    vertices += n;
    if (dynamic) room += n;
    coloured ||= !!attributes.color;
  }
  const capacity = Math.max(1, vertices + room);
  const vertexPool = createVertexPool(device, capacity, coloured, geometryBlocks);
  vertexPool.pack(sourced);
  const { concatPos, concatUv, concatNrm } = vertexPool;
  return { concatPos, concatUv, concatNrm, vertexPool };
}
