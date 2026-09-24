import {
  type BatchPage,
  DrawRanges,
  IndexRangeAllocator,
} from '../../../../packages/sdk-browser/src/cluster/batchRange.ts';
import type {
  ClusterDrawMesh,
  ClusterGeometry,
  GpuBuffer,
  HostAttributes,
} from '../../../../packages/sdk-browser/src/cluster/batchMesh.ts';

type PageSlot = { offset: number; length: number };
type UpdateRange = GpuBuffer['updateRanges'][number];

/**
 * Resident index buffer of a primitive: unique geometry shared by all its instances, owned by
 * the engine. It is the `IndexBuffer` its draw records carry: the geometry cache reads
 * `version` and `updateRanges` at the primitive's draw and uploads what changed, nothing else.
 */
export class PrimitiveIndex {
  array: Uint32Array;
  /** Bumped by every write; the upload compares it with the version it holds. */
  version = 0;
  /**
   * Ranges written and not yet sent to the GPU. A range that continues the previous one
   * lengthens it in place, which is the common case: the allocator serves pages of the same
   * packet in a row. The send is deferred to the primitive's draw: a page arrived for an
   * off-screen primitive waits its turn at no cost, and the accumulated ranges leave together.
   * The cost of a send therefore depends only on bytes that actually arrived.
   */
  readonly updateRanges: UpdateRange[] = [];
  readonly geometry: ClusterGeometry;
  allocator: IndexRangeAllocator;
  /** One range per distinct URL of the primitive; `undefined` while the page is not resident. */
  slots: Array<PageSlot | undefined>;
  /** page id -> distinct-URL rank: O(1) access without a per-frame hash table. */
  urlIndexByPage: Int32Array;
  /** Per-frame stamp by distinct URL, to dedupe the page list without a Set. */
  stamps: Int32Array;
  constructor(attributes: HostAttributes, urlIndexByPage: Int32Array, lengths: Int32Array) {
    this.urlIndexByPage = urlIndexByPage;
    let capacity = 0;
    for (let i = 0; i < lengths.length; i++) capacity += lengths[i];
    this.array = new Uint32Array(capacity);
    this.allocator = new IndexRangeAllocator(capacity);
    this.slots = new Array(lengths.length);
    this.stamps = new Int32Array(lengths.length);
    this.geometry = { index: this, attributes: { ...attributes } };
  }
  get count() {
    return this.array.length;
  }
  clearUpdateRanges() {
    this.updateRanges.length = 0;
  }
  /** Recreates the buffer larger: safety net if a page exceeds the size announced by the manifest.
   *  The next draw uploads it whole, so the ranges pending on the old bytes are dropped. */
  private growTo(capacity: number) {
    const array = new Uint32Array(capacity);
    array.set(this.array);
    this.allocator.grow(capacity - this.array.length);
    this.array = array;
    this.clearUpdateRanges();
    this.version++;
  }
  reserve(urlIndex: number, array: Uint32Array) {
    const known = this.slots[urlIndex];
    if (known) return known;
    let offset = this.allocator.allocate(array.length);
    if (offset < 0) {
      this.growTo(this.array.length + array.length);
      offset = this.allocator.allocate(array.length);
    }
    this.array.set(array, offset);
    this.addPending(offset, array.length);
    const slot: PageSlot = { offset, length: array.length };
    this.slots[urlIndex] = slot;
    return slot;
  }
  private addPending(start: number, count: number) {
    this.version++;
    const last = this.updateRanges[this.updateRanges.length - 1];
    if (last && last.start + last.count === start) last.count += count;
    else this.updateRanges.push({ start, count });
  }
  free(urlIndex: number) {
    const slot = this.slots[urlIndex];
    if (!slot) return;
    this.slots[urlIndex] = undefined;
    this.allocator.release(slot.offset, slot.length);
  }
  dispose() {
    for (const name of Object.keys(this.geometry.attributes)) delete this.geometry.attributes[name];
    this.array = new Uint32Array(0);
    this.clearUpdateRanges();
  }
}

/** One group = one primitive instance, i.e. one `renderOrder`, exactly as before. */
export class BatchGroup {
  primitive: PrimitiveIndex;
  ranges = new DrawRanges();
  mesh: ClusterDrawMesh | undefined;
  sample: BatchPage | undefined;
  touched = false;
  triangles = 0;
  transparent = false;
  /** Depth offset of a coplanar layer above 0, in hardware units, on the sub-batches of that
   *  layer. Undefined on the layer-0 batch, which draws exactly as before. */
  polygonOffsetUnits: number | undefined;
  /** Coplanar layer of this batch. 0 = the ordinary batch. */
  layer = 0;
  pending: BatchPage[] = [];
  pendingCount = 0;
  constructor(primitive: PrimitiveIndex) {
    this.primitive = primitive;
  }
}
