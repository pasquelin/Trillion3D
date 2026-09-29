import type { Texture } from '../../../../sdk-core/src/index.ts';
import { pictureSize } from '../../texture/pictureSize.ts';
import { textureRgba } from '../../visibility/types.ts';
import type { HostMaterials } from '../../host/resources.ts';
import type { WebglClusterTextures } from './textures.ts';
import { eachMap, type Material } from './materialMaps.ts';
import { textureTransferBytesFor, textureUploadMsFor } from '../../residency/transferBudgets.ts';
import { halvedPool, type ShrunkPool } from '../../residency/outOfMemory.ts';

/** Bytes a map holds on the context: its picture in RGBA, and a third more for its mip chain. */
export const heldBytes = (width: number, height: number) => Math.ceil((width * height * 16) / 3);

/**
 * WHAT A FRAME MAY UPLOAD OF THE MAPS (#840), WebGPU's tile budget on WebGL2: the bytes and the CPU
 * milliseconds the session declares (`maxTextureTransferBytesPerFrame`,
 * `maxTextureUploadMsPerFrame`), 16 MiB and 1 ms by default (`transferBudgets.ts`). Every upload
 * charges it (`WebglClusterTextures.bind`); a map a draw binds is never refused — WebGL2 holds no
 * coarser level of a map not yet sent, and drawn without it the surface would lose its picture —,
 * so what the budget defers is the queue's: the maps the census orders ahead of any draw.
 */
export class WebglUploadBudget {
  private bytes = 0;
  private ms = 0;
  private budgetBytes = textureTransferBytesFor(undefined);
  private budgetMs = textureUploadMsFor(undefined);
  /** The session's budgets; none declared keeps the defaults. */
  declare(bytes: number | undefined, ms: number | undefined) {
    this.budgetBytes = textureTransferBytesFor(bytes);
    this.budgetMs = textureUploadMsFor(ms);
  }
  beginFrame() {
    this.bytes = this.ms = 0;
  }
  charge(bytes: number, ms: number) {
    this.bytes += bytes;
    this.ms += ms;
  }
  /** Whether the frame may upload more ahead of its draws. */
  get open() {
    return this.bytes < this.budgetBytes && this.ms < this.budgetMs;
  }
}

/** A map queued ahead: what its first bind is called with. */
type Ahead = [
  unit: number,
  texture: Texture,
  srgb: boolean,
  fallback?: readonly number[],
  reader?: boolean,
];

/**
 * THE MAPS UPLOADED AHEAD OF THE DRAWS (#840). A picture sent to WebGL2 is copied through the
 * context's transfer memory; a map uploaded at the first draw that shows it held that frame
 * 100–140 ms on sponza `rue`. The census orders every map of the declared surfaces (`eachMap`, the
 * draw's own walk: same textures, same keys), attached or not, until the maps it counts reach the
 * texture pool — the bytes the session grants; each frame then uploads the next ones while its
 * budget is open (`WebglUploadBudget`), after its draws. A map with no picture yet is left to its
 * first draw, as is anything past the pool. A refused map halves the pool (`outOfMemory`).
 */
export class WebglTextureQueue {
  private queue: Ahead[] = [];
  private bytes: number[] = [];
  private next = 0;
  private poolBytes = 0;
  /** Orders the maps of `declared` within `poolBytes`. */
  order(declared: Iterable<HostMaterials>, poolBytes: number) {
    const materials = new Set<Material>(),
      counted = new Set<Texture>();
    this.queue.length = this.bytes.length = this.next = 0;
    this.poolBytes = poolBytes;
    let bytes = 0;
    for (const material of declared)
      for (const one of Array.isArray(material) ? material : [material])
        materials.add(one as Material);
    for (const material of materials)
      eachMap(material, (unit, _map, texture, srgb, fallback, reader) => {
        if (!texture || bytes >= poolBytes || counted.has(texture)) return;
        const rgba = textureRgba(texture);
        if (!rgba && !texture.image) return;
        counted.add(texture);
        const [width, height] = rgba ? [rgba.width, rgba.height] : pictureSize(texture.image);
        bytes += heldBytes(width, height);
        this.queue.push([unit, texture, srgb, fallback, reader]);
        this.bytes.push(bytes);
      });
  }
  /** Uploads the next maps while `budget` is open. */
  drain(textures: Pick<WebglClusterTextures, 'bind'>, budget: WebglUploadBudget) {
    while (this.next < this.queue.length && budget.open) {
      const [unit, texture, srgb, fallback, reader] = this.queue[this.next++];
      textures.bind(unit, texture, srgb, fallback, reader);
    }
  }
  /** The pool as it stands: the bytes it may hold ahead, and those the queue holds. */
  private pool(budgetBytes: number): ShrunkPool {
    let held = 0;
    for (const bytes of this.bytes) if (bytes <= budgetBytes) held = bytes;
    return { budgetBytes, allocatedBytes: held, clamp: null };
  }
  /** A map was refused: the pool is drawn again at half (`halvedPool`), the queue cut to it. */
  outOfMemory() {
    const before = this.pool(this.poolBytes),
      after = halvedPool(before, (bytes) => this.pool(bytes));
    if (after) {
      this.poolBytes = after.budgetBytes;
      while (this.queue.length && this.bytes[this.bytes.length - 1] > this.poolBytes) {
        this.queue.pop();
        this.bytes.pop();
      }
    }
    return { before, after };
  }
}
