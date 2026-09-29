import type { HostAttributes } from '../../host/resources.ts';
import type { PageRec } from '../../page/selection/selection.ts';
import type { GeometryBlock } from '../row/pageRowMaterial.ts';
import { uvBufferFloats } from './vertexColors.ts';
type GeometryBlocks = Map<HostAttributes, GeometryBlock>;
type List = HostAttributes[string];

/** How each list a pool block carries is laid out: its buffer, its floats per vertex, and the
 *  host lists it is written from, each with its width and the value of a missing component — a
 *  normal and a tangent share seven floats a vertex, a colour rides at the tail of the UVs. */
const LAYOUT = {
  position: { buffer: 'concatPos', stride: 3, parts: [['position', 3, 0]] },
  uv: { buffer: 'concatUv', stride: 2, parts: [['uv', 2, 0]] },
  color: { buffer: 'concatUv', stride: 4, parts: [['color', 4, 1]] },
  normal: {
    buffer: 'concatNrm',
    stride: 7,
    parts: [
      ['normal', 3, 0],
      ['tangent', 4, 0],
    ],
  },
} as const;
export type PoolList = keyof typeof LAYOUT;

/** Floats, grown to the largest write and kept: a steady frame allocates nothing. */
let scratch = new Float32Array(0);

/**
 * THE FLOAT VERTEX POOL of the WebGPU passes: the source geometry they read as floats — the
 * clusters no quantized page covers, a cache that carries none, and a world's dynamic geometry
 * (#573), whose index pages alone are paged. Its three buffers are sized once, at open, with room
 * for as many vertices again as its dynamic geometry holds: a block a record takes later — a mount
 * — is placed in that room (`place`), and a dynamic geometry's rewritten ranges are written in
 * place (`write`), neither buffer ever reallocated. Vertex colours ride at the tail of the UV
 * buffer (`vertexColors.ts`), which carries none when no packed geometry has any.
 */
export function createVertexPool(
  device: GPUDevice,
  capacity: number,
  coloured: boolean,
  blocks: GeometryBlocks,
) {
  let used = 0;
  const floats = {
    concatPos: capacity * 3,
    concatUv: uvBufferFloats(capacity, coloured),
    concatNrm: capacity * 7,
  };
  const buffer = (key: keyof typeof floats) =>
    device.createBuffer({
      label: `Trillion3D transparent geometry ${key}`,
      size: Math.max(4, floats[key] * 4),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
  const buffers = {
    concatPos: buffer('concatPos'),
    concatUv: buffer('concatUv'),
    concatNrm: buffer('concatNrm'),
  };
  /** The float of `name`'s buffer vertex `vertex` starts at: past the UVs for a colour. */
  const offsetOf = (name: PoolList, vertex: number) =>
    (name === 'color' ? capacity * LAYOUT.uv.stride : 0) + vertex * LAYOUT[name].stride;
  /** Fills `into` from float `at` with vertices `from` to `from + count - 1` of list `name`. */
  const fill = (
    into: Float32Array,
    at: number,
    attributes: HostAttributes,
    name: PoolList,
    from: number,
    count: number,
  ) => {
    const { stride, parts } = LAYOUT[name];
    let part = at;
    for (const [source, width, missing] of parts) {
      const list: List | undefined = attributes[source];
      for (let i = 0; i < count; i++)
        for (let c = 0; c < width; c++)
          into[part + i * stride + c] =
            list && c < list.itemSize ? list.getComponent(from + i, c) : missing;
      part += width;
    }
  };
  /** Whether `attributes` carry list `name`: a missing one reads zero, as a new buffer holds. */
  const holds = (attributes: HostAttributes, name: PoolList) =>
    (name !== 'color' || coloured) && LAYOUT[name].parts.some(([source]) => attributes[source]);
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
    /** Places each geometry of `sourced`, dynamic or not, and uploads the three buffers whole:
     *  the open's one packing. */
    pack(sourced: ReadonlyMap<HostAttributes, boolean>) {
      const arrays = {
        concatPos: new Float32Array(floats.concatPos),
        concatUv: new Float32Array(floats.concatUv),
        concatNrm: new Float32Array(floats.concatNrm),
      };
      for (const [attributes, dynamic] of sourced) {
        const block = claim(attributes, dynamic);
        for (const name of Object.keys(LAYOUT) as PoolList[])
          if (block && holds(attributes, name))
            fill(
              arrays[LAYOUT[name].buffer],
              offsetOf(name, block.vertexBase),
              attributes,
              name,
              0,
              block.count,
            );
      }
      for (const key of Object.keys(arrays) as (keyof typeof arrays)[])
        device.queue.writeBuffer(buffers[key], 0, arrays[key]);
    },
    /** The block of `attributes`, placed in the room the open left when it has none — a record
     *  mounted since —; undefined when that room is spent. `dynamic` marks its rows. */
    place(attributes: HostAttributes, dynamic = false) {
      const known = blocks.get(attributes);
      if (known) return known;
      const block = claim(attributes, dynamic);
      if (block)
        for (const name of Object.keys(LAYOUT) as PoolList[])
          this.write(attributes, name, 0, block.count);
      return block;
    },
    /** Writes vertices `from` to `from + count - 1` of list `name` of placed `attributes` — a
     *  normal with its tangent — in place, no buffer allocated; returns the bytes written. */
    write(attributes: HostAttributes, name: PoolList, from: number, count: number) {
      const block = blocks.get(attributes);
      if (!block || !holds(attributes, name)) return 0;
      const n = Math.min(count, block.count - from),
        size = n * LAYOUT[name].stride;
      if (scratch.length < size) scratch = new Float32Array(size);
      fill(scratch, 0, attributes, name, from, n);
      const at = offsetOf(name, block.vertexBase + from) * 4;
      device.queue.writeBuffer(buffers[LAYOUT[name].buffer], at, scratch, 0, size);
      return size * 4;
    },
  };
}

export type VertexPool = ReturnType<typeof createVertexPool>;

/**
 * Packs, once, the source geometry the passes still read as floats (`createVertexPool`): that of
 * the clusters no quantized page covers. A cluster drawn from its page contributes no vertex here,
 * and its primitive contributes none unless another of its clusters needs one: that is the whole
 * point of reading a page in place.
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
  const vertexPool = createVertexPool(
    device,
    Math.max(1, vertices + room),
    coloured,
    geometryBlocks,
  );
  vertexPool.pack(sourced);
  const { concatPos, concatUv, concatNrm } = vertexPool;
  return { concatPos, concatUv, concatNrm, vertexPool };
}
