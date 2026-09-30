import type { HostAttributes } from '../../host/resources.ts';
import type { GeometryBlock } from '../row/pageRowMaterial.ts';
import {
  BUFFERS,
  LAYOUT,
  LISTS,
  offsetOf,
  poolFits,
  poolFloats,
  type BufferKey,
  type PoolList,
  type Stores,
} from './geometryPoolLayout.ts';
import { copyPoolStores, createPoolStores, releasePoolStores } from './geometryPoolStores.ts';
import { writeFloatAtlas } from './floatAtlas.ts';
export type { PoolList } from './geometryPoolLayout.ts';
type GeometryBlocks = Map<HostAttributes, GeometryBlock>;
type List = HostAttributes[string];
/** Floats, grown to the largest write and kept: a steady frame allocates nothing. */
let scratch = new Float32Array(0);
/**
 * THE FLOAT VERTEX POOL of the WebGPU passes: the geometry they read as floats — the clusters no
 * quantized page covers, a cache that carries none, a world's dynamic geometry (#573). Its stores
 * — two storage buffers and a normal atlas (`geometryPoolStores.ts`, #1410) — hold a block per
 * sourced geometry (`place`), a dynamic geometry's rewritten ranges written in place (`write`),
 * and, after the positions, the deformation block the callers re-place (`tailFloats`). A record
 * mounted after the open, or one whose held box asks more, grows the room in place (`ensure`):
 * the stores are made wider, the buffers' contents copied, the normals written again from their
 * geometries, and the owners told (`grown`) — no reopen (#1293). Colours ride at the tail of the
 * UV buffer (`vertexColors.ts`), which carries none when no geometry has any.
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
  const floatsOf = (count: number) => poolFloats(count, tailFloats, coloured);
  let floats = floatsOf(size);
  if (!poolFits(floats, device.limits)) throw new Error('GEOMETRY_POOL_DEVICE_LIMIT');
  let stores = createPoolStores(device, floats);
  /** Writes `n` floats of the scratch at float `at` of list `name`'s store. */
  const upload = (name: PoolList, at: number, n: number) => {
    const key = LAYOUT[name].buffer;
    if (key === 'concatNrm') writeFloatAtlas(device.queue, stores.concatNrm, at, scratch, 0, n);
    else device.queue.writeBuffer(stores[key], at * 4, scratch, 0, n);
  };
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
  /** Makes the room for `need` more vertices in place when the pool is short: the buffers are
   *  made wider, what they hold copied into them, the old ones freed, the owners told. False when
   *  the device refuses the size — the caller then opens the session, as it did before (#1293). */
  const ensure = (need: number) => {
    if (used + need <= size) return true;
    let next = size;
    while (next < used + need) next *= 2;
    const wider = floatsOf(next);
    if (!poolFits(wider, device.limits)) return false;
    const made = createPoolStores(device, wider),
      encoder = device.createCommandEncoder();
    copyPoolStores(encoder, stores, made, [size, next, tailFloats], coloured);
    device.queue.submit([encoder.finish()]);
    releasePoolStores(stores);
    stores = made;
    size = next;
    floats = wider;
    // The atlas's rows follow its size: every block's normals are written again, as placed.
    for (const [attributes, block] of blocks)
      if (holds(attributes, 'normal'))
        upload(
          'normal',
          offsetOf('normal', next, block.vertexBase),
          fill(attributes, 'normal', 0, block.count),
        );
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
    /** The positions, then the deformation block. */
    get concatPos() {
      return stores.concatPos;
    },
    get concatUv() {
      return stores.concatUv;
    },
    /** The normal atlas's view: seven floats a vertex, a normal and its tangent. */
    get concatNrm() {
      return stores.concatNrm.view;
    },
    /** The normal atlas itself: its view and what it weighs on the device. */
    get normalAtlas() {
      return stores.concatNrm;
    },
    /** What the normal atlas weighs on the device. */
    get normalBytes() {
      return stores.concatNrm.bytes;
    },
    /** Frees the pool's stores: the pool is dropped. */
    destroy: () => releasePoolStores(stores),
    /** Places each geometry of `sourced`, dynamic or not, and uploads the buffers whole: the
     *  open's one packing. */
    pack(sourced: ReadonlyMap<HostAttributes, boolean>) {
      const arrays = Object.fromEntries(
        (Object.keys(floats) as (keyof typeof floats)[]).map((key) => [
          key,
          new Float32Array(floats[key]),
        ]),
      ) as Stores<Float32Array<ArrayBuffer>>;
      for (const [attributes, dynamic] of sourced) {
        const block = claim(attributes, dynamic);
        for (const name of LISTS) {
          if (!block || !holds(attributes, name)) continue;
          const n = fill(attributes, name, 0, block.count); // grows the scratch: read it after
          arrays[LAYOUT[name].buffer].set(
            scratch.subarray(0, n),
            offsetOf(name, size, block.vertexBase),
          );
        }
      }
      for (const key of BUFFERS) device.queue.writeBuffer(stores[key], 0, arrays[key]);
      const normals = arrays.concatNrm;
      writeFloatAtlas(device.queue, stores.concatNrm, 0, normals, 0, normals.length);
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
      upload(name, offsetOf(name, size, block.vertexBase + from), written);
      return written * 4;
    },
  };
}

export type VertexPool = ReturnType<typeof createVertexPool>;
