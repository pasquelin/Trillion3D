import * as THREE from 'three';
import { setGeometryBounds } from './threeBounds.ts';
import { type BatchPage, DrawRanges, IndexRangeAllocator } from './clusterBatchRange.ts';
import { ClusterDrawMesh } from './clusterBatchMesh.ts';

type PageSlot = { offset: number; length: number };

/** Resident index buffer of a primitive: unique geometry shared by all its instances. */
export class PrimitiveIndex {
  geometry = new THREE.BufferGeometry();
  array: Uint32Array;
  attribute: THREE.BufferAttribute;
  allocator: IndexRangeAllocator;
  /** One range per distinct URL of the primitive; `undefined` while the page is not resident. */
  slots: Array<PageSlot | undefined>;
  /** page id -> distinct-URL rank: O(1) access without a per-frame hash table. */
  urlIndexByPage: Int32Array;
  /** Per-frame stamp by distinct URL, to dedupe the page list without a Set. */
  stamps: Int32Array;
  /**
   * Ranges written and not yet sent to the GPU. A range that continues the previous one
   * lengthens it in place, which is the common case: the allocator serves pages of the same
   * packet in a row. The cost of a send therefore depends only on bytes that actually arrived,
   * never on the buffer size.
   */
  private pendingStarts = new Int32Array(64);
  private pendingEnds = new Int32Array(64);
  private pendingCount = 0;
  constructor(
    attributes: THREE.BufferGeometry['attributes'],
    urlIndexByPage: Int32Array,
    lengths: Int32Array,
    min: ArrayLike<number>,
    max: ArrayLike<number>,
  ) {
    this.urlIndexByPage = urlIndexByPage;
    let capacity = 0;
    for (let i = 0; i < lengths.length; i++) capacity += lengths[i];
    this.array = new Uint32Array(capacity);
    this.attribute = new THREE.BufferAttribute(this.array, 1);
    this.allocator = new IndexRangeAllocator(capacity);
    this.slots = new Array(lengths.length);
    this.stamps = new Int32Array(lengths.length);
    this.geometry.attributes = { ...attributes };
    this.geometry.setIndex(this.attribute);
    setGeometryBounds(this.geometry, min, max);
  }
  /** Recreates the buffer larger: safety net if a page exceeds the size announced by the manifest. */
  private growTo(capacity: number) {
    const array = new Uint32Array(capacity);
    array.set(this.array);
    this.allocator.grow(capacity - this.array.length);
    this.array = array;
    this.attribute = new THREE.BufferAttribute(array, 1);
    this.geometry.setIndex(this.attribute);
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
    // The send is deferred to the primitive's draw: a page arrived for an off-screen primitive
    // waits its turn at no cost, and the accumulated ranges leave together.
    this.addPending(offset, array.length);
    const slot: PageSlot = { offset, length: array.length };
    this.slots[urlIndex] = slot;
    return slot;
  }
  private addPending(offset: number, length: number) {
    const count = this.pendingCount;
    if (count > 0 && this.pendingEnds[count - 1] === offset) {
      this.pendingEnds[count - 1] = offset + length;
      return;
    }
    if (count === this.pendingStarts.length) {
      const starts = new Int32Array(count * 2);
      starts.set(this.pendingStarts);
      this.pendingStarts = starts;
      const ends = new Int32Array(count * 2);
      ends.set(this.pendingEnds);
      this.pendingEnds = ends;
    }
    this.pendingStarts[count] = offset;
    this.pendingEnds[count] = offset + length;
    this.pendingCount = count + 1;
  }
  /** Called just before the primitive's render: Three.js will consume the send right after. It
   *  sorts and merges neighbouring ranges itself before emitting them. */
  flush() {
    if (!this.pendingCount) return;
    for (let i = 0; i < this.pendingCount; i++)
      this.attribute.addUpdateRange(
        this.pendingStarts[i],
        this.pendingEnds[i] - this.pendingStarts[i],
      );
    this.attribute.needsUpdate = true;
    this.pendingCount = 0;
  }
  free(urlIndex: number) {
    const slot = this.slots[urlIndex];
    if (!slot) return;
    this.slots[urlIndex] = undefined;
    this.allocator.release(slot.offset, slot.length);
  }
  dispose() {
    for (const name of Object.keys(this.geometry.attributes)) this.geometry.deleteAttribute(name);
    this.geometry.dispose();
  }
}

/** One group = one primitive instance, i.e. one `renderOrder`, exactly as before. */
export class BatchGroup {
  primitive: PrimitiveIndex;
  ranges = new DrawRanges();
  mesh: ClusterDrawMesh | undefined;
  sample: BatchPage | undefined;
  attached = false;
  touched = false;
  triangles = 0;
  transparent = false;
  /** Frozen back/front pair when the material is two-sided transparent; otherwise undefined. */
  split: [THREE.Material, THREE.Material] | undefined;
  /** Frozen depth-bias material, on the sub-batches of a coplanar layer above 0.
   *  Undefined on the layer-0 batch, which draws exactly as before. */
  biased: THREE.Material | [THREE.Material, THREE.Material] | undefined;
  /** Coplanar layer of this batch. 0 = the ordinary batch. */
  layer = 0;
  pending: BatchPage[] = [];
  pendingCount = 0;
  constructor(primitive: PrimitiveIndex) {
    this.primitive = primitive;
  }
}
