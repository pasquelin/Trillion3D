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
  normal: { buffer: 'concatNrm', stride: 7, parts: [['normal', 3, 0], ['tangent', 4, 0]] },
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
  const buffer = (floats: number) =>
    device.createBuffer({
      label: 'Trillion3D float vertices',
      size: Math.max(4, floats * 4),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
  const buffers = {
    concatPos: buffer(capacity * 3),
    concatUv: buffer(uvBufferFloats(capacity, coloured)),
    concatNrm: buffer(capacity * 7),
  };
  /** Writes vertices `from` to `from + count - 1` of `attributes`' list `name` at `base`. */
  const writeList = (attributes: HostAttributes, name: PoolList, base: number, from: number, count: number) => {
    const { buffer: target, stride, parts } = LAYOUT[name];
    const floats = count * stride;
    if (scratch.length < floats) scratch = new Float32Array(floats);
    let at = 0;
    for (const [source, width, missing] of parts) {
      const list: List | undefined = attributes[source];
      for (let i = 0; i < count; i++)
        for (let c = 0; c < width; c++)
          scratch[i * stride + at + c] =
            list && c < list.itemSize ? list.getComponent(from + i, c) : missing;
      at += width;
    }
    const tail = name === 'color' ? capacity * LAYOUT.uv.stride : 0;
    device.queue.writeBuffer(buffers[target], (tail + (base + from) * stride) * 4, scratch, 0, floats);
    return floats * 4;
  };
  return {
    ...buffers,
    /** The block of `attributes`, placed in the room left when it has none; undefined when the
     *  room is spent. `dynamic` marks the rows that read it (`FLAG_DYNAMIC`). */
    place(attributes: HostAttributes, dynamic = false) {
      const known = blocks.get(attributes);
      if (known) return known;
      const count = attributes.position?.count ?? 0;
      if (used + count > capacity || (attributes.color && !coloured)) return undefined;
      const block: GeometryBlock = {
        vertexBase: used,
        count,
        hasUv: !!attributes.uv,
        hasNormal: !!attributes.normal,
        hasTangent: !!attributes.tangent,
        hasColor: !!attributes.color,
        dynamic,
      };
      blocks.set(attributes, block);
      used += count;
      for (const name of Object.keys(LAYOUT) as PoolList[]) this.write(attributes, name, 0, count);
      return block;
    },
    /** Writes vertices `from` to `from + count - 1` of list `name` of placed `attributes` —
     *  a normal with its tangent —; returns the bytes written, none for a list it lacks. */
    write(attributes: HostAttributes, name: PoolList, from: number, count: number) {
      const block = blocks.get(attributes);
      const held = LAYOUT[name].parts.some(([source]) => attributes[source]);
      if (!block || !held || (name === 'color' && !coloured)) return 0;
      return writeList(attributes, name, block.vertexBase, from, Math.min(count, block.count - from));
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
    if (!rec.geometryPage) sourced.set(rec.attributes, rec.sourceMesh?.geometry.usage === 'dynamic');
  let vertices = 0,
    room = 0,
    coloured = false;
  for (const [attributes, dynamic] of sourced) {
    const n = attributes.position?.count ?? 0;
    vertices += n;
    if (dynamic) room += n;
    coloured ||= !!attributes.color;
  }
  const vertexPool = createVertexPool(device, Math.max(1, vertices + room), coloured, geometryBlocks);
  for (const [attributes, dynamic] of sourced) vertexPool.place(attributes, dynamic);
  const { concatPos, concatUv, concatNrm } = vertexPool;
  return { concatPos, concatUv, concatNrm, vertexPool };
}
