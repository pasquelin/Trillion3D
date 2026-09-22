import type { HostAttributes, HostMaterials } from './hostResources.ts';
import type { MatrixElements } from './matrixElements.ts';
import type { PageSurface } from './pageSurface.ts';

/** Structural shape of a page record. Deliberately structural: no coupling to pageSelection.ts. */
export type BatchPage = {
  id: number;
  url: string;
  array?: Uint32Array;
  triangles: number;
  min: number[];
  max: number[];
  attributes: HostAttributes;
  /** The engine's surface record, what everything on the way to the image reads. */
  material: PageSurface;
  /** The host declaration the WebGL2 draw record hands back to the renderer that owns it. */
  declaration: HostMaterials;
  transparent?: boolean;
  sourceOrder?: number;
  matrix: MatrixElements;
  renderOrder: number;
  /** Coplanar depth layer, 0 for a cluster the compiler left alone. */
  depthLayer?: number;
};

export type FreeRange = { offset: number; length: number };

/** Range allocator: first free slot, neighbour merge on release, growth as last resort. */
export class IndexRangeAllocator {
  private ranges: FreeRange[] = [];
  private total: number;
  private busy = 0;
  constructor(capacity: number) {
    this.total = Math.max(0, Math.floor(capacity));
    if (this.total > 0) this.ranges.push({ offset: 0, length: this.total });
  }
  get capacity() {
    return this.total;
  }
  get used() {
    return this.busy;
  }
  get freeRanges(): readonly FreeRange[] {
    return this.ranges;
  }
  /** Returns the offset of the reserved range, or -1 if no contiguous slot fits. */
  allocate(length: number) {
    if (!(length > 0)) return -1;
    for (let i = 0; i < this.ranges.length; i++) {
      const range = this.ranges[i];
      if (range.length < length) continue;
      const offset = range.offset;
      if (range.length === length) this.ranges.splice(i, 1);
      else {
        range.offset += length;
        range.length -= length;
      }
      this.busy += length;
      return offset;
    }
    return -1;
  }
  release(offset: number, length: number) {
    if (!(length > 0)) return;
    this.busy -= length;
    let i = 0;
    while (i < this.ranges.length && this.ranges[i].offset < offset) i++;
    const previous = i > 0 ? this.ranges[i - 1] : undefined,
      next = this.ranges[i];
    const joinsPrevious = !!previous && previous.offset + previous.length === offset;
    const joinsNext = !!next && offset + length === next.offset;
    if (joinsPrevious && joinsNext) {
      previous!.length += length + next!.length;
      this.ranges.splice(i, 1);
      return;
    }
    if (joinsPrevious) {
      previous!.length += length;
      return;
    }
    if (joinsNext) {
      next!.offset = offset;
      next!.length += length;
      return;
    }
    this.ranges.splice(i, 0, { offset, length });
  }
  /** Extends capacity; the added room merges with the free tail. */
  grow(extra: number) {
    const added = Math.max(0, Math.floor(extra));
    if (!added) return this.total;
    const end = this.total;
    this.total += added;
    this.busy += added;
    this.release(end, added);
    return this.total;
  }
}

/** Sub-draw list reused from frame to frame. `starts` in bytes (what Three.js expects), `counts` in indices. */
export class DrawRanges {
  starts = new Int32Array(8);
  counts = new Int32Array(8);
  count = 0;
  reset() {
    this.count = 0;
  }
  /** Adds a range; merges with the previous one if it continues it. Returns true if a sub-draw was created. */
  push(offset: number, length: number) {
    const bytes = offset * Uint32Array.BYTES_PER_ELEMENT;
    if (this.count > 0) {
      const last = this.count - 1;
      if (this.starts[last] + this.counts[last] * Uint32Array.BYTES_PER_ELEMENT === bytes) {
        this.counts[last] += length;
        return false;
      }
    }
    if (this.count === this.starts.length) {
      const size = this.starts.length * 2;
      const starts = new Int32Array(size);
      starts.set(this.starts);
      this.starts = starts;
      const counts = new Int32Array(size);
      counts.set(this.counts);
      this.counts = counts;
    }
    this.starts[this.count] = bytes;
    this.counts[this.count] = length;
    this.count++;
    return true;
  }
}
