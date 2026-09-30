import { storageBufferCap } from '../../residency/pools.ts';
import type { HostAttributes } from '../../host/resources.ts';
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
type BufferKey = (typeof BUFFERS)[number];
type Buffers<T> = Record<BufferKey, T>;
/** Floats, grown to the largest write and kept: a steady frame allocates nothing. */
let scratch = new Float32Array(0);
/**
 * THE FLOAT VERTEX POOL of the WebGPU passes: the geometry they read as floats — the clusters no
 * quantized page covers, a cache that carries none, a world's dynamic geometry (#573). Its buffers
 * hold a block per sourced geometry (`place`), a dynamic geometry's rewritten ranges written in
 * place (`write`), and, after them, the deformation block the callers re-place (`tailFloats`). A
 * record mounted after the open, or one whose held box asks more, grows the room in place
 * (`ensure`): the buffers are made wider, what they hold copied into them, and the owners told
 * (`grown`) — no reopen (#1293). Colours ride at the tail of the UV buffer
 * (`vertexColors.ts`), which carries none when no geometry has any.
 */
export function createVertexPool(
  device: GPUDevice,
  capacity: number,
  coloured: boolean,
  blocks: GeometryBlocks,
  tailFloats = 0,
  grown?: (capacity: number) => void,
) {
  let used = 0,
    size = Math.max(1, capacity);
  const floatsOf = (count: number): Buffers<number> => ({
    concatPos: count * 3 + tailFloats,
    concatNrm: count * 7,
    concatUv: uvBufferFloats(count, coloured),
  });
  const withinDevice = (next: Buffers<number>) =>
    BUFFERS.every((key) => next[key] * 4 <= storageBufferCap(device.limits));
  const label = (key: BufferKey) => `Trillion3D transparent geometry ${key}`;
  const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
  let floats = floatsOf(size);
  if (!withinDevice(floats)) throw new Error('GEOMETRY_POOL_DEVICE_LIMIT');
  const make = (sizes: Buffers<number>) =>
    Object.fromEntries(
      BUFFERS.map((key) => [
        key,
        device.createBuffer({ label: label(key), size: Math.max(4, sizes[key] * 4), usage }),
      ]),
    ) as Buffers<GPUBuffer>;
  let buffers = make(floats);
  /** The float of `name`'s buffer vertex `vertex` starts at: in the UVs' tail for a colour. */
  const offsetOf = (name: PoolList, vertex: number) =>
    name === 'color' ? colorFloatAt(size, vertex) : vertex * LAYOUT[name].stride;
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
  /** What a growth of `from` vertices to `to` copies, in floats: `[source, destination, count]`
   *  per region — the vertices, the colour tail when the UVs carry one, and the deformation block. */
  const copies = (key: BufferKey, from: number, to: number): [number, number, number][] => {
    if (key === 'concatPos')
      return tailFloats
        ? [
            [0, 0, from * 3],
            [from * 3, to * 3, tailFloats],
          ]
        : [[0, 0, from * 3]];
    if (key === 'concatUv')
      return coloured
        ? [
            [0, 0, from * UV_FLOATS],
            [from * UV_FLOATS, to * UV_FLOATS, from * COLOR_FLOATS],
          ]
        : [[0, 0, from * UV_FLOATS]];
    return [[0, 0, from * 7]];
  };
  /** Makes the room for `need` more vertices in place when the pool is short: the buffers are
   *  made wider, what they hold copied into them, the old ones freed, the owners told. False when
   *  the device refuses the size — the caller then opens the session, as it did before (#1293). */
  const ensure = (need: number) => {
    if (used + need <= size) return true;
    let next = size;
    while (next < used + need) next *= 2;
    const wider = floatsOf(next);
    if (!withinDevice(wider)) return false;
    const made = make(wider),
      encoder = device.createCommandEncoder();
    for (const key of BUFFERS)
      for (const [source, destination, count] of copies(key, size, next))
        if (count > 0)
          encoder.copyBufferToBuffer(
            buffers[key],
            source * 4,
            made[key],
            destination * 4,
            count * 4,
          );
    device.queue.submit([encoder.finish()]);
    for (const key of BUFFERS) buffers[key].destroy();
    buffers = made;
    size = next;
    floats = wider;
    grown?.(next);
    return true;
  };
  /** A block for `attributes` in the room left, grown when it is spent; undefined when the device
   *  bounds the size. */
  const claim = (attributes: HostAttributes, dynamic: boolean) => {
    const count = attributes.position?.count ?? 0;
    if ((attributes.color && !coloured) || !ensure(count)) return undefined;
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
      ) as Buffers<Float32Array<ArrayBuffer>>;
      for (const [attributes, dynamic] of sourced) {
        const block = claim(attributes, dynamic);
        for (const name of LISTS) {
          if (!block || !holds(attributes, name)) continue;
          const n = fill(attributes, name, 0, block.count); // grows the scratch: read it after
          arrays[LAYOUT[name].buffer].set(scratch.subarray(0, n), offsetOf(name, block.vertexBase));
        }
      }
      for (const key of BUFFERS) device.queue.writeBuffer(buffers[key], 0, arrays[key]);
      scratch = new Float32Array(0); // the open's largest list is not kept
    },
    /** The block of `attributes`, placed in the room the open left when it has none — a record
     *  mounted since —; a mount past that room grows it in place (#1293). `dynamic` marks its
     *  rows. */
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
      const written = fill(attributes, name, from, Math.min(count, block.count - from));
      const at = offsetOf(name, block.vertexBase + from) * 4;
      device.queue.writeBuffer(buffers[LAYOUT[name].buffer], at, scratch, 0, written);
      return written * 4;
    },
  };
}

export type VertexPool = ReturnType<typeof createVertexPool>;
